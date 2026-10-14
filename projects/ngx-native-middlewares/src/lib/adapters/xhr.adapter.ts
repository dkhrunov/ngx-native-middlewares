import { HttpRequestSnapshot, HttpResponseSnapshot, INativeMiddlewareRunner } from '../types';
import { resolveUrl, sanitizeResponseHeaders } from './utils';

const STATE_KEY = '__NativeMiddlewareState';

interface XhrMiddlewareState {
    method: string;
    url: string;
    async: boolean;
    username?: string | null;
    password?: string | null;
    requestHeaders: Record<string, string>;
    deferredListeners: Array<{
        type: string;
        listener: EventListenerOrEventListenerObject;
        options?: boolean | AddEventListenerOptions;
    }>;
    deferredHandlerProps: Partial<Record<XhrHandlerProp, ((this: XMLHttpRequest, ev: Event) => unknown) | null>>;
    finished: boolean;
    transformedBody: string | null;
    originalBody: Document | XMLHttpRequestBodyInit | null | undefined;
}

type XhrHandlerProp = 'onreadystatechange' | 'onload' | 'onloadend' | 'onerror' | 'onabort' | 'ontimeout';

const HANDLER_PROPS: XhrHandlerProp[] = ['onreadystatechange', 'onload', 'onloadend', 'onerror', 'onabort', 'ontimeout'];

const DEFERRED_EVENTS = new Set(['readystatechange', 'load', 'loadend', 'error', 'abort', 'timeout']);

/**
 * Patches `XMLHttpRequest`:
 * - Middleware may mutate the request before the network and/or the response before the caller.
 * - Cache hit (skipping `next`) — no network call is made.
 */
export function installXhrAdapter(registry: INativeMiddlewareRunner): () => void {
    const proto = XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;
    const nativeSetRequestHeader = proto.setRequestHeader;
    const nativeAddEventListener = proto.addEventListener;
    const nativeRemoveEventListener = proto.removeEventListener;

    const handlerDescriptors = new Map<XhrHandlerProp, PropertyDescriptor | undefined>();

    for (const prop of HANDLER_PROPS) {
        handlerDescriptors.set(
            prop,
            Object.getOwnPropertyDescriptor(proto, prop) ?? Object.getOwnPropertyDescriptor(XMLHttpRequestEventTarget.prototype, prop),
        );
    }

    proto.open = function patchedOpen(
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null,
    ): void {
        const state: XhrMiddlewareState = {
            method: String(method).toUpperCase(),
            url: String(url),
            async: async !== false,
            username,
            password,
            requestHeaders: {},
            deferredListeners: [],
            deferredHandlerProps: {},
            finished: false,
            transformedBody: null,
            originalBody: undefined,
        };

        Object.defineProperty(this, STATE_KEY, {
            value: state,
            writable: true,
            configurable: true,
        });

        nativeOpen.call(this, method, url, async ?? true, username, password);
    };

    /**
     * Headers live only in the snapshot — native set is deferred until `next()`,
     * so middleware can change them before the real send.
     */
    proto.setRequestHeader = function patchedSetRequestHeader(this: XMLHttpRequest, name: string, value: string): void {
        const state = getState(this);
        if (state?.async) {
            state.requestHeaders[name] = value;
            return;
        }
        nativeSetRequestHeader.call(this, name, value);
    };

    proto.addEventListener = function patchedAddEventListener(
        this: XMLHttpRequest,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
    ): void {
        const state = getState(this);
        if (state?.async && DEFERRED_EVENTS.has(type)) {
            state.deferredListeners.push({ type, listener, options });
            return;
        }
        nativeAddEventListener.call(this, type, listener, options);
    };

    proto.removeEventListener = function patchedRemoveEventListener(
        this: XMLHttpRequest,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
    ): void {
        const state = getState(this);
        if (state?.async && DEFERRED_EVENTS.has(type)) {
            state.deferredListeners = state.deferredListeners.filter((item) => item.listener !== listener || item.type !== type);
        }
        nativeRemoveEventListener.call(this, type, listener, options);
    };

    for (const prop of HANDLER_PROPS) {
        const descriptor = handlerDescriptors.get(prop);
        Object.defineProperty(proto, prop, {
            configurable: true,
            enumerable: true,
            get(this: XMLHttpRequest) {
                const state = getState(this);
                if (state?.async && prop in state.deferredHandlerProps) {
                    return state.deferredHandlerProps[prop] ?? null;
                }
                return descriptor?.get?.call(this) ?? null;
            },
            set(this: XMLHttpRequest, handler: ((this: XMLHttpRequest, ev: Event) => unknown) | null) {
                const state = getState(this);
                if (state?.async) {
                    state.deferredHandlerProps[prop] = handler;
                    return;
                }
                descriptor?.set?.call(this, handler);
            },
        });
    }

    proto.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
        const state = getState(this);

        // Sync XHR не совместим с async middleware — bypass.
        if (!state || !state.async) {
            if (state) {
                applyNativeRequestHeaders(this, state.requestHeaders, nativeSetRequestHeader);
            }
            nativeSend.call(this, body);
            return;
        }

        state.originalBody = body;

        const request: HttpRequestSnapshot = {
            url: resolveUrl(state.url),
            method: state.method,
            headers: { ...state.requestHeaders },
            body: typeof body === 'string' ? body : null,
        };

        void runXhrMiddlewarePipeline(this, state, request, registry, {
            nativeOpen,
            nativeSend,
            nativeSetRequestHeader,
            nativeAddEventListener,
            nativeRemoveEventListener,
        });
    };

    return () => {
        proto.open = nativeOpen;
        proto.send = nativeSend;
        proto.setRequestHeader = nativeSetRequestHeader;
        proto.addEventListener = nativeAddEventListener;
        proto.removeEventListener = nativeRemoveEventListener;

        for (const prop of HANDLER_PROPS) {
            const descriptor = handlerDescriptors.get(prop);
            if (descriptor) {
                Object.defineProperty(proto, prop, descriptor);
            } else {
                delete (proto as unknown as Record<string, unknown>)[prop];
            }
        }
    };
}

type NativeXhrFns = {
    nativeOpen: typeof XMLHttpRequest.prototype.open;
    nativeSend: typeof XMLHttpRequest.prototype.send;
    nativeSetRequestHeader: typeof XMLHttpRequest.prototype.setRequestHeader;
    nativeAddEventListener: typeof XMLHttpRequest.prototype.addEventListener;
    nativeRemoveEventListener: typeof XMLHttpRequest.prototype.removeEventListener;
};

function getState(xhr: XMLHttpRequest): XhrMiddlewareState | undefined {
    return (xhr as unknown as Record<string, XhrMiddlewareState | undefined>)[STATE_KEY];
}

async function runXhrMiddlewarePipeline(
    xhr: XMLHttpRequest,
    state: XhrMiddlewareState,
    request: HttpRequestSnapshot,
    registry: INativeMiddlewareRunner,
    natives: NativeXhrFns,
): Promise<void> {
    if (state.finished) {
        return;
    }

    let networkCalled = false;

    try {
        const finalResponse = await registry.handle(request, async () => {
            networkCalled = true;
            return performNativeRequest(xhr, state, request, natives);
        });

        applyResponseToXhr(xhr, state, finalResponse);

        if (!networkCalled) {
            // Cache-hit: сети не было — имитируем успешное завершение.
            fakeDoneReadyState(xhr);
        }
    } catch (error) {
        console.error('[ngx-native-middlewares] XHR middleware failed:', error);
        if (!networkCalled) {
            applyResponseToXhr(xhr, state, {
                status: 0,
                statusText: 'Middleware Error',
                headers: {},
                body: '',
            });
            fakeDoneReadyState(xhr);
        }
    } finally {
        state.finished = true;
        flushDeferredHandlers(xhr, state);
    }
}

/**
 * Real send: re-open + headers from the snapshot (after request middleware) + send.
 * Preserves responseType/timeout/withCredentials around open().
 */
function performNativeRequest(
    xhr: XMLHttpRequest,
    state: XhrMiddlewareState,
    request: HttpRequestSnapshot,
    natives: NativeXhrFns,
): Promise<HttpResponseSnapshot> {
    const { nativeOpen, nativeSend, nativeSetRequestHeader, nativeAddEventListener, nativeRemoveEventListener } = natives;

    return new Promise((resolve, reject) => {
        const onReadyStateChange = (): void => {
            if (xhr.readyState !== XMLHttpRequest.DONE) {
                return;
            }
            nativeRemoveEventListener.call(xhr, 'readystatechange', onReadyStateChange);
            resolve(snapshotFromXhr(xhr));
        };

        nativeAddEventListener.call(xhr, 'readystatechange', onReadyStateChange);

        const preserved = {
            responseType: xhr.responseType,
            timeout: xhr.timeout,
            withCredentials: xhr.withCredentials,
        };

        try {
            nativeOpen.call(xhr, request.method, request.url, state.async, state.username, state.password);

            xhr.responseType = preserved.responseType;
            xhr.timeout = preserved.timeout;
            xhr.withCredentials = preserved.withCredentials;

            applyNativeRequestHeaders(xhr, request.headers, nativeSetRequestHeader);

            const bodyToSend = request.body !== null && request.body !== undefined ? request.body : state.originalBody;

            nativeSend.call(xhr, bodyToSend);
        } catch (error) {
            nativeRemoveEventListener.call(xhr, 'readystatechange', onReadyStateChange);
            reject(error);
        }
    });
}

function applyNativeRequestHeaders(
    xhr: XMLHttpRequest,
    headers: Record<string, string>,
    nativeSetRequestHeader: typeof XMLHttpRequest.prototype.setRequestHeader,
): void {
    for (const [name, value] of Object.entries(headers)) {
        nativeSetRequestHeader.call(xhr, name, value);
    }
}

function snapshotFromXhr(xhr: XMLHttpRequest): HttpResponseSnapshot {
    const headers: Record<string, string> = {};
    const raw = xhr.getAllResponseHeaders();

    if (raw) {
        for (const line of raw.trim().split(/[\r\n]+/)) {
            const idx = line.indexOf(':');
            if (idx > 0) {
                headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        }
    }

    let body = '';
    try {
        body = xhr.responseText ?? '';
    } catch {
        body = '';
    }

    return {
        status: xhr.status,
        statusText: xhr.statusText,
        headers,
        body,
    };
}

function applyResponseToXhr(xhr: XMLHttpRequest, state: XhrMiddlewareState, response: HttpResponseSnapshot): void {
    state.transformedBody = response.body;
    const headers = sanitizeResponseHeaders(response.headers);

    Object.defineProperty(xhr, 'responseText', {
        configurable: true,
        enumerable: true,
        get: () => state.transformedBody ?? '',
    });

    Object.defineProperty(xhr, 'response', {
        configurable: true,
        enumerable: true,
        get: () => {
            if (xhr.responseType === '' || xhr.responseType === 'text') {
                return state.transformedBody ?? '';
            }
            if (xhr.responseType === 'json') {
                try {
                    return JSON.parse(state.transformedBody ?? '');
                } catch {
                    return null;
                }
            }
            return state.transformedBody ?? '';
        },
    });

    Object.defineProperty(xhr, 'status', {
        configurable: true,
        enumerable: true,
        get: () => response.status,
    });

    Object.defineProperty(xhr, 'statusText', {
        configurable: true,
        enumerable: true,
        get: () => response.statusText,
    });

    const headerLines = Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n');

    xhr.getAllResponseHeaders = () => (headerLines ? `${headerLines}\r\n` : '');
    xhr.getResponseHeader = (name: string) => {
        const lower = name.toLowerCase();
        const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lower);
        return entry?.[1] ?? null;
    };
}

function fakeDoneReadyState(xhr: XMLHttpRequest): void {
    Object.defineProperty(xhr, 'readyState', {
        configurable: true,
        enumerable: true,
        get: () => XMLHttpRequest.DONE,
    });
}

function flushDeferredHandlers(xhr: XMLHttpRequest, state: XhrMiddlewareState): void {
    for (const { type, listener } of state.deferredListeners) {
        invokeListener(xhr, type, listener);
    }

    for (const prop of HANDLER_PROPS) {
        const handler = state.deferredHandlerProps[prop];
        if (typeof handler === 'function') {
            const eventType = prop === 'onreadystatechange' ? 'readystatechange' : prop.slice(2);
            handler.call(xhr, new Event(eventType));
        }
    }
}

function invokeListener(xhr: XMLHttpRequest, type: string, listener: EventListenerOrEventListenerObject): void {
    const event = new Event(type);
    if (typeof listener === 'function') {
        listener.call(xhr, event);
    } else if (listener && typeof listener.handleEvent === 'function') {
        listener.handleEvent(event);
    }
}
