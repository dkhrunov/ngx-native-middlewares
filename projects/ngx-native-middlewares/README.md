# `@dkhrunov/ngx-native-middlewares`

In many apps HTTP traffic does not go only through Angular `HttpClient`. It also uses **native** browser APIs — `window.fetch` and `XMLHttpRequest` — and libraries **on top** of them (for example **axios**, widget wrappers, platform `fetchWithCache`).

Each of those layers has its own interception model (axios interceptors, a `fetch` patch, a service worker, and so on), which makes it hard to:

- mutate request/response in one consistent way;
- plug in logic from both root and feature/lazy modules;
- cover `fetch` and XHR with a single contract.

This library gives a **unified, centralized** way to write middleware over native HTTP transports: one `NativeMiddleware` pipeline for fetch and XHR (and everything built on them), with Angular DX via `provideNativeMiddlewarePlatform` / `provideNativeMiddlewares`.

You can change the request **before it is sent** and/or the response **before it is returned to the caller**, without patching third-party widgets and without tying yourself to a specific HTTP client.

## Why you need it

- installs thin adapters on **fetch** and **XHR** (covering axios and similar clients);
- runs traffic through a shared `NativeMiddleware` list;
- provides Angular DX: `provideNativeMiddlewarePlatform` (root) / `provideNativeMiddlewares` (feature).

Typical scenarios:

- rewriting response fields;
- adding headers / editing the body before the network call;
- serving a cache without hitting the network (return a snapshot without calling `next()`).

## How it works

```text
fetch / XHR.send call
            │
            ▼
┌──────────────────────┐
│  NativeMiddleware[]  │  ← root + feature (lazy)
│  (req → next → res)  │
└───────────┬──────────┘
            │
next() = real network
            │
            ▼
    response to caller
```

The middleware contract follows the **Koa / Node.js middleware** model: `(request, next) => response`. Code before `next` runs on the way “to the network”; code after `next` runs on the way “back to the caller”.

```ts
type NativeMiddleware = (request: HttpRequestSnapshot, next: NativeMiddlewareNext) => Promise<HttpResponseSnapshot>;
```

| Stage           | What you can do                                      |
| --------------- | ---------------------------------------------------- |
| Before `next()` | Mutate `request.url` / `method` / `headers` / `body` |
| `await next()`  | Real send (already with the mutated request)         |
| After `next()`  | Return a mutated response                            |
| Skip `next()`   | Cache hit: no network call                           |

> Mutate **properties** of the `request` object; do not replace the object itself (`request = { ... }` will not work).

## Setup

### 1. Root (required, once)

In `AppModule` / `ApplicationConfig` — **after** `fetchWithCache()` has already been called in `main.ts` (if you use it):

```ts
import {
  provideNativeMiddlewarePlatform,
  // withAdapters({ fetch: true, xhr: true }), // optional 2nd+ argument
} from "@dkhrunov/ngx-native-middlewares";
import { myMiddleware } from "./middlewares";

@NgModule({
  providers: [
    provideNativeMiddlewarePlatform([
      myMiddleware,
      // other global middleware
    ]),
  ],
})
export class AppModule {}
```

Root setup:

- creates `NativeMiddlewareRegistry` (middleware chain);
- creates `NativeMiddlewarePlatform` and installs fetch/XHR patches (`install`);
- registers the provided middleware.

Adapter options (root only):

```ts
provideNativeMiddlewarePlatform(
  [...],
  withAdapters({ fetch: true, xhr: true }),
  // or XHR only: withAdapters({ fetch: false, xhr: true })
)
```

By default **both** transports are enabled.

### 2. Feature / lazy route (optional)

Middleware is added to the **same root registry**, without a second `install`:

```ts
import { provideNativeMiddlewares } from "@dkhrunov/ngx-native-middlewares";
import { featureMiddleware } from "./middlewares";

export const FEATURE_ROUTES: Routes = [
  {
    path: "my-feature",
    providers: [provideNativeMiddlewares([featureMiddleware])],
    loadChildren: () => import("./feature.routes"),
  },
];
```

Or in a feature NgModule `providers` — what matters is that the route/feature environment injector runs (`ENVIRONMENT_INITIALIZER`).

|                                 | Root `provideNativeMiddlewarePlatform` | Feature `provideNativeMiddlewares` |
| ------------------------------- | -------------------------------------- | ---------------------------------- |
| Registry + adapters             | yes                                    | no                                 |
| Adds middleware to the pipeline | yes (1st argument)                     | yes (only argument)                |
| When                            | bootstrap                              | feature/lazy injector creation     |
| `withAdapters`                  | yes (2nd+ argument)                    | no                                 |

Feature middleware **extends** root; it does not replace it. Re-registering the same middleware function is ignored.

## Middleware examples

### Request only (before send)

```ts
import { NativeMiddleware } from "@dkhrunov/ngx-native-middlewares";

export const addTraceHeaderMiddleware: NativeMiddleware = async (request, next) => {
  request.headers["X-Trace-Id"] = crypto.randomUUID();

  if (request.body?.includes("Something")) {
    const payload = JSON.parse(request.body);
    payload.variables = { ...payload.variables, lang: "en" };
    request.body = JSON.stringify(payload);
  }

  return next();
};
```

### Response only (after network, before caller)

```ts
import { NativeMiddleware } from "@dkhrunov/ngx-native-middlewares";

export const renameActiveLabelMiddleware: NativeMiddleware = async (request, next) => {
  const response = await next();

  if (!request.body?.includes("getClients")) {
    return response;
  }

  const json = JSON.parse(response.body);
  const statuses = json?.data?.getClients?.statuses;

  if (Array.isArray(statuses)) {
    json.data.getClients.statuses = statuses.map((item: { name: string; value?: string }) => (item.name === "active" ? { ...item, value: "Active client" } : item));
  }

  return { ...response, body: JSON.stringify(json) };
};
```

### Request and response (+ cache hit)

```ts
import { NativeMiddleware } from "@dkhrunov/ngx-native-middlewares";

const cache = new Map<string, unknown>();

export const clientsCacheMiddleware: NativeMiddleware = async (request, next) => {
  if (!request.body?.includes("getClients")) {
    return next();
  }

  const payload = JSON.parse(request.body);

  // --- request ---
  payload.variables.request.limit = Math.min(payload.variables.request.limit ?? 50, 50);
  request.body = JSON.stringify(payload);

  const cacheKey = JSON.stringify(payload.variables);
  const cached = cache.get(cacheKey);

  // --- skip network ---
  if (cached) {
    return {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cached),
    };
  }

  // --- response ---
  const response = await next();
  cache.set(cacheKey, JSON.parse(response.body));
  return response;
};
```

## Middleware order

Array order is chain order (first entry is the outermost):

```ts
provideNativeMiddlewarePlatform([
  outerMiddleware, // sees the request first, the response last
  innerMiddleware,
]);
```

Root middleware run first (as registered at bootstrap); feature middleware is **appended** when the feature loads.

## Limitations

- **Sync XHR** — middleware is not applied (bypass).
- Body in the snapshot is mostly a `string`. `FormData` / `Blob` without body edits pass through as-is.
- Do not call `provideNativeMiddlewarePlatform` again in a feature — use only `provideNativeMiddlewares`.

## Public API

| API                                                                     | Purpose                                              |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `provideNativeMiddlewarePlatform(middleware[], ...features)`            | Root: like `provideRouter` — middleware + features   |
| `provideNativeMiddlewares(middleware[])`                                | Feature/lazy: like `provideRoutes` — middleware only |
| `withAdapters`                                                          | Root feature: fetch/XHR transports                   |
| `NativeMiddleware`                                                      | Middleware type                                      |
| `HttpRequestSnapshot` / `HttpResponseSnapshot` / `NativeMiddlewareNext` | req/res contract for middleware                      |
| `NativeMiddlewareAdaptersConfig`                                        | `withAdapters` config                                |
