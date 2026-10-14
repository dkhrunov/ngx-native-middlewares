/*
 * Public API Surface of ngx-native-middlewares
 */
export type {
  HttpRequestSnapshot,
  HttpResponseSnapshot,
  NativeMiddleware,
  NativeMiddlewareAdaptersConfig,
  NativeMiddlewareNext,
} from './lib/types';

export {
  provideNativeMiddlewarePlatform,
  provideNativeMiddlewares,
  withAdapters,
} from './lib/provide';
