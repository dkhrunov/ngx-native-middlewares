import { Provider } from '@angular/core';

/**
 * Normalized HTTP request snapshot.
 */
export interface HttpRequestSnapshot {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
}

/**
 * Normalized HTTP response snapshot.
 */
export interface HttpResponseSnapshot {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
}

export type NativeMiddlewareNext = () => Promise<HttpResponseSnapshot>;

/**
 * Koa/Express-style middleware:
 * - before `next` — mutate `request` fields (url/method/headers/body);
 * - `await next()` — real network call (adapter sends the mutated request);
 * - after `next` — return a mutated response to the caller;
 *
 * Mutate properties on the given `request`; do not replace the object itself.
 */
export type NativeMiddleware = (request: HttpRequestSnapshot, next: NativeMiddlewareNext) => Promise<HttpResponseSnapshot>;

/** Minimal registry contract for adapters (avoids circular imports). */
export interface INativeMiddlewareRunner {
    /**
     * Registers middleware at runtime.
     *
     * Duplicate references are ignored.
     */
    register(middlewares: readonly NativeMiddleware[]): void;
    /**
     * Runs the middleware chain. Called by fetch/XHR adapters.
     */
    handle(request: HttpRequestSnapshot, next: NativeMiddlewareNext): Promise<HttpResponseSnapshot>;
}

/**
 * Lifecycle contract for transport adapters (fetch / XHR, etc.).
 *
 * Bridges native browser APIs with {@link INativeMiddlewareRunner}.
 */
export interface INativeMiddlewarePlatform {
    /** Installs global transport patches. Idempotent. */
    install(): void;
    /** Removes global patches (tests / hot reload). */
    uninstall(): void;
}

export enum NativeMiddlewareFeatureKind {
    Adapters = 0,
}

export interface NativeMiddlewareFeature<TKind extends NativeMiddlewareFeatureKind = NativeMiddlewareFeatureKind> {
    ɵkind: TKind;
    ɵproviders: Provider[];
}

export interface NativeMiddlewareAdaptersConfig {
    /** Intercept `window.fetch`. Defaults to `true`. */
    fetch?: boolean;
    /** Intercept `XMLHttpRequest` (axios, etc.). Defaults to `true`. */
    xhr?: boolean;
}
