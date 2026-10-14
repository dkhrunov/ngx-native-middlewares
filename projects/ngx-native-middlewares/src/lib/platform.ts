import { Inject, Injectable, Optional } from '@angular/core';

import { installFetchAdapter } from './adapters/fetch.adapter';
import { installXhrAdapter } from './adapters/xhr.adapter';
import { NativeMiddlewareRegistry } from './registry';
import { NATIVE_MIDDLEWARE_ADAPTERS } from './tokens';
import { INativeMiddlewarePlatform, NativeMiddlewareAdaptersConfig } from './types';

const DEFAULT_ADAPTERS: Required<NativeMiddlewareAdaptersConfig> = {
    fetch: true,
    xhr: true,
};

/**
 * Lifecycle for transport adapters (fetch / XHR).
 * Bridges global browser APIs with {@link NativeMiddlewareRegistry}.
 */
@Injectable()
export class NativeMiddlewarePlatform implements INativeMiddlewarePlatform {
    private readonly adapters: Required<NativeMiddlewareAdaptersConfig>;
    private installed = false;
    private uninstallers: Array<() => void> = [];

    constructor(
        private readonly registry: NativeMiddlewareRegistry,
        @Optional() @Inject(NATIVE_MIDDLEWARE_ADAPTERS) adapters: NativeMiddlewareAdaptersConfig | null,
    ) {
        this.adapters = {
            fetch: adapters?.fetch ?? DEFAULT_ADAPTERS.fetch,
            xhr: adapters?.xhr ?? DEFAULT_ADAPTERS.xhr,
        };
    }

    /**
     * Installs global fetch/XHR patches. Idempotent.
     */
    public install(): void {
        if (this.installed || typeof window === 'undefined') {
            return;
        }

        this.installed = true;

        if (this.adapters.fetch) {
            this.uninstallers.push(installFetchAdapter(this.registry));
        }

        if (this.adapters.xhr) {
            this.uninstallers.push(installXhrAdapter(this.registry));
        }
    }

    /**
     * Removes global patches (for tests / hot reload).
     */
    public uninstall(): void {
        for (const uninstall of this.uninstallers.splice(0)) {
            uninstall();
        }

        this.installed = false;
    }
}
