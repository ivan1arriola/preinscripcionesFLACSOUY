import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Never expose credentials, connection strings or internal stacks in production responses
  const message = err instanceof Error ? err.message : 'Error inesperado';
  console.error('[API Error]', message);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno en el servidor.',
    },
  });
}
