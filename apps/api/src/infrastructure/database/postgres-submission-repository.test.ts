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

  it('handles client submission idempotency via saveOrGet', async () => {
    const clientSubmissionId = `test-client-${Date.now()}-${Math.random()}`;
    const submissionData = {
      clientSubmissionId,
      targetId: 'davia-c11',
      configRevision: 'davia-c11-v1',
      targetTitle: 'DAVIA Cohorte 11',
      targetKind: 'academic_offer',
      values: {
        nombre: 'María',
        email: 'maria@example.com',
      },
    };

    const firstResult = await repository.saveOrGet(submissionData);
    expect(firstResult.id).toBeDefined();
    expect(firstResult.existing).toBe(false);

    const secondResult = await repository.saveOrGet(submissionData);
    expect(secondResult.id).toBe(firstResult.id);
    expect(secondResult.existing).toBe(true);
  });

  it('updates processing and file statuses', async () => {
    const fileToken = `token-${Date.now()}-${Math.random()}`;
    const submissionData = {
      targetId: 'davia-c11',
      configRevision: 'davia-c11-v1',
      targetTitle: 'DAVIA Cohorte 11',
      targetKind: 'academic_offer',
      values: {
        nombre: 'Pedro',
      },
      files: [
        {
          token: fileToken,
          fieldKey: 'cv',
          originalName: 'cv.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        },
      ],
    };

    const result = await repository.save(submissionData);

    // markProcessing
    await repository.markProcessing(result.id, 'success');
    const procRow = await db
      .selectFrom('submission_processing')
      .selectAll()
      .where('submission_id', '=', result.id)
      .executeTakeFirst();
    expect(procRow?.status).toBe('success');

    // markFileStored
    await repository.markFileStored(fileToken, 'drive-123');
    const fileRow = await db
      .selectFrom('submission_files')
      .selectAll()
      .where('token', '=', fileToken)
      .executeTakeFirst();
    expect(fileRow?.status).toBe('success');
    expect(fileRow?.drive_file_id).toBe('drive-123');

    // markFileFailed
    await repository.markFileFailed(fileToken, 'Network error');
    const fileRowFailed = await db
      .selectFrom('submission_files')
      .selectAll()
      .where('token', '=', fileToken)
      .executeTakeFirst();
    expect(fileRowFailed?.status).toBe('failed');
    expect(fileRowFailed?.error_message).toBe('Network error');
  });
});
