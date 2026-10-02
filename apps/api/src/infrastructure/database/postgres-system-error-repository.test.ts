import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { runMigrations } from './migrate.js';
import { PostgresSystemErrorRepository } from './postgres-system-error-repository.js';
import { createSystemError } from '../../domain/system-error.js';

describe('PostgresSystemErrorRepository', () => {
  const db = createKyselyDb();
  const repo = new PostgresSystemErrorRepository(db);

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('saves, retrieves, filters, and resolves system errors in PostgreSQL', async () => {
    const error1 = createSystemError({
      id: 'test-err-sheets-1',
      severity: 'critical',
      origin: 'sheets',
      code: 'SHEET_NOT_FOUND',
      message: 'No se encontró la planilla especificada',
      context: { sheetId: 'abc1234' },
      targetId: 'diplomado-salud',
    });

    const error2 = createSystemError({
      id: 'test-err-wp-1',
      severity: 'low',
      origin: 'wordpress',
      code: 'WP_TIMEOUT',
      message: 'WordPress REST timeout',
      context: { url: 'https://flacso.edu.uy' },
      targetId: 'maestria-genero',
    });

    await repo.save(error1);
    await repo.save(error2);

    const fetched = await repo.findById('test-err-sheets-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.code).toBe('SHEET_NOT_FOUND');
    expect(fetched?.severity).toBe('critical');
    expect(fetched?.status).toBe('unresolved');
    expect(fetched?.context).toEqual({ sheetId: 'abc1234' });

    // Filter by origin
    const sheetsErrors = await repo.findMany({ origin: 'sheets' });
    expect(sheetsErrors.some((e) => e.id === 'test-err-sheets-1')).toBe(true);
    expect(sheetsErrors.some((e) => e.id === 'test-err-wp-1')).toBe(false);

    // Resolve error
    const resolved = await repo.resolve('test-err-sheets-1', 'admin-user');
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedBy).toBe('admin-user');
    expect(resolved?.resolvedAt).toBeDefined();

    // Verify status filter
    const unresolved = await repo.findMany({ status: 'unresolved' });
    expect(unresolved.some((e) => e.id === 'test-err-sheets-1')).toBe(false);
    expect(unresolved.some((e) => e.id === 'test-err-wp-1')).toBe(true);
  });
});
