export type DatabaseHealth = 'up' | 'down';

export interface HealthStatusInput {
  database: DatabaseHealth;
}

export interface HealthStatusResponse {
  status: 'ok' | 'degraded';
  database: DatabaseHealth;
}

export function healthResponse(input: HealthStatusInput): HealthStatusResponse {
  return {
    status: input.database === 'up' ? 'ok' : 'degraded',
    database: input.database,
  };
}
