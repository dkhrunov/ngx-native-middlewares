import { HttpRequestSnapshot, INativeMiddlewareRunner } from '../types';
import { requestToSnapshot, responseToSnapshot, snapshotToResponse } from './utils';

type FetchFn = typeof window.fetch;

/**
 * Patches `window.fetch`:
 * - Middleware may mutate the request before the network and/or the response before the caller.
 * - Cache hit (skipping `next`) — no network call is made.
 */
export function installFetchAdapter(registry: INativeMiddlewareRunner): () => void {
    const nativeFetch: FetchFn = window.fetch.bind(window);

    const patchedFetch: FetchFn = async (input, init) => {
        const requestSnapshot = await requestToSnapshot(input, init);

        const responseSnapshot = await registry.handle(requestSnapshot, async () => {
            const upstream = await nativeFetch(...toUpstreamFetchArgs(input, init, requestSnapshot));

            return responseToSnapshot(upstream);
        });

        return snapshotToResponse(responseSnapshot);
    };

    window.fetch = patchedFetch;

    return () => {
        if (window.fetch === patchedFetch) {
            window.fetch = nativeFetch;
        }
    };
}

/**
 * Keeps original init fields (credentials, signal, mode, …),
 * overriding method/headers/body from the snapshot after request middleware.
 */
function toUpstreamFetchArgs(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    snapshot: HttpRequestSnapshot,
): [string, RequestInit] {
    const base: RequestInit =
        input instanceof Request
            ? {
                  method: input.method,
                  headers: input.headers,
                  body: undefined,
                  mode: input.mode,
                  credentials: input.credentials,
                  cache: input.cache,
                  redirect: input.redirect,
                  referrer: input.referrer,
                  referrerPolicy: input.referrerPolicy,
                  integrity: input.integrity,
                  keepalive: input.keepalive,
                  signal: input.signal,
              }
            : {};

    const merged: RequestInit = {
        ...base,
        ...init,
        method: snapshot.method,
        headers: snapshot.headers,
        body: snapshot.body ?? undefined,
    };

    return [snapshot.url, merged];
}
