import { Router, type RouterOptions } from 'express';

type AnyHandler = (...args: unknown[]) => unknown;

/**
 * Express 4 no captura las promesas rechazadas de los handlers `async`: el error termina como
 * `unhandledRejection` (que en Node ≥ 15 cierra el proceso) y la petición queda colgada.
 * Este envoltorio reenvía el rechazo a `next(err)` para que lo resuelva el `errorHandler` central.
 */
export function forwardAsyncErrors<T extends AnyHandler>(handler: T): T {
  // Los manejadores de error de Express (4 argumentos) y los valores que no son funciones no se tocan.
  if (typeof handler !== 'function' || handler.length === 4) return handler;

  const wrapped = (...args: unknown[]) => {
    const next = args[2] as ((error?: unknown) => void) | undefined;
    try {
      const outcome = handler(...args);
      if (outcome && typeof (outcome as Promise<unknown>).catch === 'function') {
        (outcome as Promise<unknown>).catch((error) => next?.(error));
      }
      return outcome;
    } catch (error) {
      if (next) {
        next(error);
        return undefined;
      }
      throw error;
    }
  };
  return wrapped as unknown as T;
}

const WRAPPED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'] as const;

/** Un `Router` cuyos handlers `async` reenvían sus errores a `next`. */
export function createAsyncRouter(options?: RouterOptions): Router {
  const router = Router(options);
  for (const method of WRAPPED_METHODS) {
    const original = (router[method] as unknown as AnyHandler).bind(router);
    (router as unknown as Record<string, AnyHandler>)[method] = (...args: unknown[]) =>
      original(...args.map((arg) => (typeof arg === 'function' ? forwardAsyncErrors(arg as AnyHandler) : arg)));
  }
  return router;
}
