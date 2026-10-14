import { HttpRequestSnapshot, HttpResponseSnapshot } from '../types';

export function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
    const result: Record<string, string> = {};

    if (!headers) {
        return result;
    }

    if (headers instanceof Headers) {
        headers.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }

    if (Array.isArray(headers)) {
        for (const [key, value] of headers) {
            result[key] = value;
        }
        return result;
    }

    return { ...headers };
}

export function recordToHeaders(headers: Record<string, string>): Headers {
    return new Headers(headers);
}

/**
 * Response headers after a body rewrite: strip encoding/length,
 * otherwise clients (e.g. axios) may decode the body incorrectly.
 */
export function sanitizeResponseHeaders(headers: Record<string, string>): Record<string, string> {
    const next: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'content-encoding' || lower === 'content-length') {
            continue;
        }
        next[key] = value;
    }

    if (!Object.keys(next).some((key) => key.toLowerCase() === 'content-type')) {
        next['content-type'] = 'application/json';
    }

    return next;
}

export function resolveUrl(url: string): string {
    try {
        return new URL(url, window.location.origin).href;
    } catch {
        return url;
    }
}

export async function requestToSnapshot(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<HttpRequestSnapshot> {
    const request = input instanceof Request ? input : null;
    const url = resolveUrl(
        request?.url ?? (typeof input === 'string' ? input : String(input)),
    );
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = {
        ...headersToRecord(request?.headers),
        ...headersToRecord(init?.headers),
    };

    let body: string | null = null;
    const initBody = init?.body;

    if (typeof initBody === 'string') {
        body = initBody;
    } else if (initBody == null && request) {
        try {
            body = await request.clone().text();
        } catch {
            body = null;
        }
    }

    return { url, method, headers, body: body || null };
}

export async function responseToSnapshot(response: Response): Promise<HttpResponseSnapshot> {
    const body = await response.clone().text();

    return {
        status: response.status,
        statusText: response.statusText,
        headers: headersToRecord(response.headers),
        body,
    };
}

export function snapshotToResponse(snapshot: HttpResponseSnapshot): Response {
    const headers = sanitizeResponseHeaders(snapshot.headers);

    return new Response(snapshot.body, {
        status: snapshot.status,
        statusText: snapshot.statusText,
        headers: recordToHeaders(headers),
    });
}

export function tryParseJson(body: string): unknown | null {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}
