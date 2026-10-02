import { describe, it, expect } from 'vitest';
import {
  createSystemError,
  resolveSystemError,
  sanitizeErrorContext,
} from './system-error.js';

describe('system-error domain', () => {
  it('sanitizes sensitive context keys recursively', () => {
    const rawContext = {
      spreadsheetId: 'sheet-123',
      adminPassword: 'supersecretpassword',
      authToken: 'bearer-xyz-123',
      userEmail: 'estudiante@example.com',
      ci: '1.234.567-8',
      nested: {
        api_key: 'key-999',
        targetId: 'diplomado-2026',
        deep: {
          clientSecret: 'secret-val',
          validField: 42,
        },
      },
      list: [
        { token: 'secret-in-array', status: 'ok' },
        'regular string',
      ],
    };

    const sanitized = sanitizeErrorContext(rawContext);

    expect(sanitized.spreadsheetId).toBe('sheet-123');
    expect(sanitized.adminPassword).toBe('[REDACTED]');
    expect(sanitized.authToken).toBe('[REDACTED]');
    expect(sanitized.userEmail).toBe('[REDACTED]');
    expect(sanitized.ci).toBe('[REDACTED]');

    const nested = sanitized.nested as Record<string, any>;
    expect(nested.api_key).toBe('[REDACTED]');
    expect(nested.targetId).toBe('diplomado-2026');
    expect(nested.deep.clientSecret).toBe('[REDACTED]');
    expect(nested.deep.validField).toBe(42);

    const list = sanitized.list as any[];
    expect(list[0].token).toBe('[REDACTED]');
    expect(list[0].status).toBe('ok');
    expect(list[1]).toBe('regular string');
  });

  it('creates an unresolved system error with sanitized context', () => {
    const fixedDate = new Date('2026-10-02T10:00:00Z');
    const err = createSystemError({
      id: 'err-1',
      severity: 'high',
      origin: 'sheets',
      code: 'SHEETS_COLUMN_MISSING',
      message: 'Columna requerida "Cedula" no encontrada',
      context: { sheet: 'Respuestas', token: 'secret-token' },
      targetId: 'diploma-educacion',
      now: fixedDate,
    });

    expect(err).toEqual({
      id: 'err-1',
      severity: 'high',
      origin: 'sheets',
      code: 'SHEETS_COLUMN_MISSING',
      message: 'Columna requerida "Cedula" no encontrada',
      context: { sheet: 'Respuestas', token: '[REDACTED]' },
      targetId: 'diploma-educacion',
      status: 'unresolved',
      createdAt: '2026-10-02T10:00:00.000Z',
      updatedAt: '2026-10-02T10:00:00.000Z',
    });
  });

  it('marks an error as resolved with timestamp and resolver user', () => {
    const original = createSystemError({
      id: 'err-2',
      severity: 'medium',
      origin: 'wordpress',
      code: 'WP_CACHE_STALE',
      message: 'Cache desactualizado',
    });

    const resolveDate = new Date('2026-10-02T11:00:00Z');
    const resolved = resolveSystemError(original, 'admin-ivan', resolveDate);

    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('admin-ivan');
    expect(resolved.resolvedAt).toBe('2026-10-02T11:00:00.000Z');
    expect(resolved.updatedAt).toBe('2026-10-02T11:00:00.000Z');
  });
});
