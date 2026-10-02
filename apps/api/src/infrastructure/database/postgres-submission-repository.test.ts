import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { PostgresSubmissionRepository } from './postgres-submission-repository.js';
import { runMigrations } from './migrate.js';

describe('PostgresSubmissionRepository (Integration with PostgreSQL)', () => {
  const dbUrl =
    process.env.DATABASE_URL ??
    'postgres://flacso:flacso_password@localhost:5433/flacso_preinscripciones';

  const db = createKyselyDb(dbUrl);
  const repository = new PostgresSubmissionRepository(db);

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('persists submission and values in normalized 3NF tables', async () => {
    const submissionData = {
      targetId: 'davia-c11',
      configRevision: 'davia-c11-v1',
      targetTitle: 'DAVIA Cohorte 11',
      targetKind: 'academic_offer',
      values: {
        nombre: 'Carlos',
        apellido: 'Rodríguez',
        email: 'carlos@example.com',
        documento: '3.456.789-0',
        orientacion: 'educacion',
        mencion: 'tec-edu',
      },
    };

    const result = await repository.save(submissionData);
    expect(result.id).toBeDefined();
    expect(result.id).toMatch(/^sub_/);

    // 1. Verify row in `submissions` table
    const submissionRow = await db
      .selectFrom('submissions')
      .selectAll()
      .where('id', '=', result.id)
      .executeTakeFirst();

    expect(submissionRow).toBeDefined();
    expect(submissionRow?.target_id).toBe('davia-c11');
    expect(submissionRow?.config_revision).toBe('davia-c11-v1');

    // 2. Verify rows in `submission_values` table
    const valuesRows = await db
      .selectFrom('submission_values')
      .selectAll()
      .where('submission_id', '=', result.id)
      .execute();

    expect(valuesRows).toHaveLength(6);
    const valueMap = Object.fromEntries(valuesRows.map((r) => [r.input_key, r.value]));
    expect(valueMap.nombre).toBe('Carlos');
    expect(valueMap.apellido).toBe('Rodríguez');
    expect(valueMap.email).toBe('carlos@example.com');
    expect(valueMap.documento).toBe('3.456.789-0');
    expect(valueMap.orientacion).toBe('educacion');
    expect(valueMap.mencion).toBe('tec-edu');

    // 3. Verify target snapshot in `targets` table
    const targetRow = await db
      .selectFrom('targets')
      .selectAll()
      .where('id', '=', 'davia-c11')
      .executeTakeFirst();

    expect(targetRow).toBeDefined();
    expect(targetRow?.title).toBe('DAVIA Cohorte 11');
  });
});
