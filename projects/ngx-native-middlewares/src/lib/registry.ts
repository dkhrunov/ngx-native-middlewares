import { Inject, Injectable, Optional } from '@angular/core';

import { NATIVE_MIDDLEWARE } from './tokens';
import { HttpRequestSnapshot, HttpResponseSnapshot, INativeMiddlewareRunner, NativeMiddleware, NativeMiddlewareNext } from './types';

/**
 * Native middleware registry: stores the chain and runs request/response through it.
 */
@Injectable()
export class NativeMiddlewareRegistry implements INativeMiddlewareRunner {
    private readonly middlewares: NativeMiddleware[] = [];

    constructor(@Optional() @Inject(NATIVE_MIDDLEWARE) middlewares: NativeMiddleware[] | null) {
        if (middlewares?.length) {
            this.register(middlewares);
        }
    }

    /**
     * Adds middleware at runtime.
     *
     * Duplicate references are ignored.
     */
    public register(middlewares: readonly NativeMiddleware[]): void {
        for (const middleware of middlewares) {
            if (!this.middlewares.includes(middleware)) {
                this.middlewares.push(middleware);
            }
        }
    }

    /**
     * Runs the middleware chain. Called by fetch/XHR adapters.
     */
    public handle(request: HttpRequestSnapshot, next: NativeMiddlewareNext): Promise<HttpResponseSnapshot> {
        const chain = this.middlewares.reduceRight<NativeMiddlewareNext>((nextFn, middleware) => () => middleware(request, nextFn), next);

        return chain();
    }
}
