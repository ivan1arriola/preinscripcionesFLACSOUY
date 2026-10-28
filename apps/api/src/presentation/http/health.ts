export type DatabaseHealth = 'up' | 'down';

export interface HealthStatusInput {
  database: DatabaseHealth;
}

export interface HealthStatusResponse {
  status: 'ok' | 'degraded';
  database: DatabaseHealth;
}

/**
 * Estado del catálogo de WordPress. `token_missing` y `unauthorized` significan
 * que no llegan los correos de las coordinaciones; `incompatible`, que el
 * contrato v1 cambió. `unavailable` es transitorio (red, timeout, 5xx).
 */
export type CatalogHealthCode = 'ok' | 'not_configured' | 'token_missing' | 'unauthorized' | 'incompatible' | 'unavailable';

export interface CatalogHealthResponse {
  status: 'ok' | 'degraded';
  code: CatalogHealthCode;
  rejectedTargets: number;
}

export interface CatalogHealthInput {
  tokenConfigured: boolean;
  /** Resultado de consultar el catálogo: la cantidad de destinos descartados, o el error. */
  result: { rejectedTargets: number } | { error: unknown };
}

/** Sólo expone un código y un conteo: nunca tokens, correos ni contenido del catálogo. */
export function catalogHealthResponse(input: CatalogHealthInput): CatalogHealthResponse {
  if ('error' in input.result) {
    const error = input.result.error as { statusCode?: unknown; message?: unknown } | null;
    const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : undefined;
    const message = typeof error?.message === 'string' ? error.message : '';
    const code: CatalogHealthCode = statusCode === 401 || statusCode === 403
      ? 'unauthorized'
      : /incompatible con el contrato/i.test(message) ? 'incompatible' : 'unavailable';
    return { status: 'degraded', code, rejectedTargets: 0 };
  }
  const rejectedTargets = input.result.rejectedTargets;
  return input.tokenConfigured
    ? { status: 'ok', code: 'ok', rejectedTargets }
    : { status: 'degraded', code: 'token_missing', rejectedTargets };
}

export function healthResponse(input: HealthStatusInput): HealthStatusResponse {
  return {
    status: input.database === 'up' ? 'ok' : 'degraded',
    database: input.database,
  };
}
