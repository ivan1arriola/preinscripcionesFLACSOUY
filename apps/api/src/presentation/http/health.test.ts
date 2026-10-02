import { describe, it, expect } from 'vitest';
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
