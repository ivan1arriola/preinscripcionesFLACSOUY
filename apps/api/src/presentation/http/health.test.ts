import { describe, it, expect, vi } from 'vitest';
import { healthResponse } from './health.js';

describe('healthResponse', () => {
  it('returns ok status when database is up', () => {
    const result = healthResponse({ database: 'up' });
    expect(result).toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('returns degraded status when database is down', () => {
    const result = healthResponse({ database: 'down' });
    expect(result).toEqual({
      status: 'degraded',
      database: 'down',
    });
  });

  it('does not leak connection details or secrets', () => {
    const result = healthResponse({ database: 'down' });
    expect(result).not.toHaveProperty('connection');
    expect(result).not.toHaveProperty('connectionString');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('host');
    expect(result).not.toHaveProperty('user');
    expect(Object.keys(result).sort()).toEqual(['database', 'status']);
  });
});

describe('createReadinessHandler', () => {
  it('returns 200 ready when checks pass', async () => {
    const { createReadinessHandler } = await import('./readiness.js');
    const handler = createReadinessHandler({
      checkDatabase: async () => true,
    });

    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res: any = { status: statusMock };

    await handler({} as any, res);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', checks: expect.objectContaining({ database: 'up' }) })
    );
  });

  it('returns 503 not_ready when database check fails', async () => {
    const { createReadinessHandler } = await import('./readiness.js');
    const handler = createReadinessHandler({
      checkDatabase: async () => false,
    });

    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res: any = { status: statusMock };

    await handler({} as any, res);
    expect(statusMock).toHaveBeenCalledWith(503);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'not_ready', checks: expect.objectContaining({ database: 'down' }) })
    );
  });
});
