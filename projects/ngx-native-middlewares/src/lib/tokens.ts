import { InjectionToken } from '@angular/core';

import { NativeMiddleware, NativeMiddlewareAdaptersConfig } from './types';

/** Multi-token holding the list of native middleware. */
export const NATIVE_MIDDLEWARE = new InjectionToken<NativeMiddleware>('NATIVE_MIDDLEWARE');

/**
 * Explicit adapters config. When unset, both fetch and XHR are enabled.
 * Provided via {@link withAdapters}.
 */
export const NATIVE_MIDDLEWARE_ADAPTERS = new InjectionToken<NativeMiddlewareAdaptersConfig>(
    'NATIVE_MIDDLEWARE_ADAPTERS',
);
