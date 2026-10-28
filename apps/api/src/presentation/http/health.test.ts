import { describe, it, expect } from 'vitest';
import { catalogHealthResponse, healthResponse } from './health.js';

describe('catalogHealthResponse', () => {
  it('is ok when the token is configured and the catalog answers', () => {
    expect(catalogHealthResponse({ tokenConfigured: true, result: { rejectedTargets: 0 } }))
      .toEqual({ status: 'ok', code: 'ok', rejectedTargets: 0 });
  });

  it('flags a missing token even though WordPress answers with the public catalog', () => {
    expect(catalogHealthResponse({ tokenConfigured: false, result: { rejectedTargets: 2 } }))
      .toEqual({ status: 'degraded', code: 'token_missing', rejectedTargets: 2 });
  });

  it('classifies 401 and 403 as unauthorized', () => {
    for (const statusCode of [401, 403]) {
      expect(catalogHealthResponse({ tokenConfigured: true, result: { error: { statusCode, message: 'x' } } }).code)
        .toBe('unauthorized');
    }
  });

  it('classifies a contract mismatch as incompatible', () => {
    const error = { message: 'Respuesta de WordPress incompatible con el contrato v1: targets: Required' };
    expect(catalogHealthResponse({ tokenConfigured: true, result: { error } }).code).toBe('incompatible');
  });

  it('treats network errors and 5xx as transient', () => {
    expect(catalogHealthResponse({ tokenConfigured: true, result: { error: new Error('timeout') } }).code).toBe('unavailable');
    expect(catalogHealthResponse({ tokenConfigured: true, result: { error: { statusCode: 502, message: 'Error HTTP 502' } } }).code)
      .toBe('unavailable');
  });

  it('never leaks the error message, token or emails', () => {
    const result = catalogHealthResponse({
      tokenConfigured: true,
      result: { error: { statusCode: 401, message: 'Bearer abc secret@flacso.edu.uy' } },
    });
    expect(JSON.stringify(result)).not.toMatch(/Bearer|secret|@/);
    expect(Object.keys(result).sort()).toEqual(['code', 'rejectedTargets', 'status']);
  });
});

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
