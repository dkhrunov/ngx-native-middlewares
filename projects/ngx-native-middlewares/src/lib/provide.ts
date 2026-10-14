import { APP_INITIALIZER, ENVIRONMENT_INITIALIZER, EnvironmentProviders, inject, makeEnvironmentProviders, Provider } from '@angular/core';

import { NativeMiddlewarePlatform } from './platform';
import { NativeMiddlewareRegistry } from './registry';
import { NATIVE_MIDDLEWARE, NATIVE_MIDDLEWARE_ADAPTERS } from './tokens';
import { NativeMiddleware, NativeMiddlewareAdaptersConfig, NativeMiddlewareFeature, NativeMiddlewareFeatureKind } from './types';

/**
 * Root: boots the native middleware platform (registry + fetch/XHR adapters).
 *
 * Call **once** in the root (`AppModule` / `ApplicationConfig`),
 * after platform `fetchWithCache` in `main.ts` if you use it.
 *
 * Register feature/lazy middleware via {@link provideNativeMiddlewares}.
 *
 * @example
 * ```ts
 * providers: [
 *   provideNativeMiddlewarePlatform(
 *     [myCustomMiddleware],
 *     withAdapters({ fetch: true, xhr: true }),
 *   ),
 * ]
 * ```
 */
export function provideNativeMiddlewarePlatform(
    middlewares: NativeMiddleware[],
    ...features: Array<NativeMiddlewareFeature>
): EnvironmentProviders {
    const providers: Provider[] = [
        NativeMiddlewareRegistry,
        NativeMiddlewarePlatform,
        ...middlewaresToProviders(middlewares),
        {
            provide: APP_INITIALIZER,
            multi: true,
            useFactory: () => {
                const platform = inject(NativeMiddlewarePlatform);

                return () => {
                    platform.install();
                };
            },
        },
    ];

    for (const feature of features) {
        providers.push(...feature.ɵproviders);
    }

    return makeEnvironmentProviders(providers);
}

/**
 * Feature/lazy: adds middleware to the **root** registry.
 *
 * Does not reinstall adapters. Requires root {@link provideNativeMiddlewarePlatform}.
 *
 * @example
 * ```ts
 * providers: [
 *   provideNativeMiddlewares([featureOnlyMiddleware]),
 * ]
 * ```
 */
export function provideNativeMiddlewares(middlewares: NativeMiddleware[]): EnvironmentProviders {
    return makeEnvironmentProviders([
        ...middlewaresToProviders(middlewares),
        {
            provide: ENVIRONMENT_INITIALIZER,
            multi: true,
            useFactory: () => {
                const registry = inject(NativeMiddlewareRegistry);

                return () => {
                    registry.register(middlewares);
                };
            },
        },
    ]);
}

/**
 * Explicitly selects which transports to patch.
 * If omitted, both (`fetch` + `xhr`) are enabled by default.
 * Root {@link provideNativeMiddlewarePlatform} only.
 */
export function withAdapters(config: NativeMiddlewareAdaptersConfig): NativeMiddlewareFeature {
    return {
        ɵkind: NativeMiddlewareFeatureKind.Adapters,
        ɵproviders: [
            {
                provide: NATIVE_MIDDLEWARE_ADAPTERS,
                useValue: config,
            },
        ],
    };
}

function middlewaresToProviders(middlewares: NativeMiddleware[]): Provider[] {
    return middlewares.map((middleware) => ({
        provide: NATIVE_MIDDLEWARE,
        useValue: middleware,
        multi: true,
    }));
}
