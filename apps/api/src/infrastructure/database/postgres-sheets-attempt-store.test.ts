import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { PostgresSubmissionRepository } from './postgres-submission-repository.js';
import { PostgresSheetsAttemptStore } from './postgres-sheets-attempt-store.js';
import { runMigrations } from './migrate.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

integrationDescribe('PostgresSheetsAttemptStore (Integration with PostgreSQL)', () => {
  const db = createKyselyDb(dbUrl);
  const submissions = new PostgresSubmissionRepository(db);
  const store = new PostgresSheetsAttemptStore(db);

  beforeAll(async () => {
    await runMigrations(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  async function newSubmission(clientSubmissionId = `c-${Math.random().toString(36).slice(2)}`) {
    return submissions.saveOrGet({
      clientSubmissionId,
      targetId: 'davia-c11',
      configRevision: 'v1',
      targetTitle: 'DAVIA',
      targetKind: 'academic_offer',
      values: { email: 'a@example.com' },
    } as never);
  }

  it('returns null for a non-existent submission', async () => {
    const result = await store.get('sub-non-existent');
    expect(result).toBeNull();
  });

  it('retrieves the initial attempt state for a newly accepted submission', async () => {
    const saved = await newSubmission();
    const record = await store.get(saved.id);

    expect(record).not.toBeNull();
    expect(record?.submissionId).toBe(saved.id);
    expect(record?.status).toBe('pending');
    expect(record?.sheetAttemptStartedAt).toBeNull();
    expect(record?.sheetWrittenAt).toBeNull();
    expect(record?.nextAttemptAt).toBeNull();
  });

  it('records sheet_attempt_started_at before attempting write', async () => {
    const saved = await newSubmission();
    const startedAt = new Date('2026-11-06T10:00:00Z');

    await store.recordAttemptStarted(saved.id, startedAt);

    const record = await store.get(saved.id);
    expect(record?.sheetAttemptStartedAt).toEqual(startedAt);
  });

  it('marks sheet_uncertain with next_attempt_at and optional error message', async () => {
    const saved = await newSubmission();
    const startedAt = new Date('2026-11-06T10:00:00Z');
    const nextAttemptAt = new Date('2026-11-06T10:03:20Z'); // startedAt + 200 s

    await store.recordAttemptStarted(saved.id, startedAt);
    await store.markUncertain(saved.id, nextAttemptAt, 'ETIMEDOUT al conectar con Sheets');

    const record = await store.get(saved.id);
    expect(record?.status).toBe('sheet_uncertain');
    expect(record?.sheetAttemptStartedAt).toEqual(startedAt);
    expect(record?.nextAttemptAt).toEqual(nextAttemptAt);
  });

  it('records sheet_written_at when write is confirmed', async () => {
    const saved = await newSubmission();
    const writtenAt = new Date('2026-11-06T10:01:00Z');

    await store.recordWritten(saved.id, writtenAt);

    const record = await store.get(saved.id);
    expect(record?.sheetWrittenAt).toEqual(writtenAt);
  });
  it('keeps the row snapshot with the attempt and drops the personal values once written', async () => {
    const saved = await newSubmission();
    const payload = {
      spreadsheetId: 'sheet-1', sheetName: 'Hoja 1', requiredColumns: ['ID de seguimiento'],
      trackingId: saved.id, valuesByColumnName: { 'ID de seguimiento': saved.id, Email: 'a@example.com' },
    };
    await store.recordAttemptStarted(saved.id, new Date('2026-11-06T10:00:00Z'), payload);
    expect((await store.get(saved.id))?.payload).toEqual(payload);

    await store.recordWritten(saved.id, new Date('2026-11-06T10:00:01Z'));
    const after = await store.get(saved.id);
    expect(after?.payload).toEqual({ ...payload, valuesByColumnName: {} });
    expect(JSON.stringify(after?.payload)).not.toContain('a@example.com');
  });

  it('loads the sheets context with the target of the submission', async () => {
    const saved = await newSubmission();
    const payload = {
      spreadsheetId: 'sheet-1', sheetName: 'Hoja 1', requiredColumns: ['ID de seguimiento'],
      trackingId: saved.id, valuesByColumnName: { 'ID de seguimiento': saved.id },
    };
    expect(await store.loadContext(saved.id)).toBeNull();
    await store.recordAttemptStarted(saved.id, new Date(), payload);
    expect(await store.loadContext(saved.id)).toEqual({ targetId: 'davia-c11', ...payload });
  });
});
