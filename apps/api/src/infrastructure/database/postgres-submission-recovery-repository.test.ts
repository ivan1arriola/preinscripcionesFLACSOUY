import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { createKyselyDb } from './kysely.js';
import { runMigrations } from './migrate.js';
import { PostgresSubmissionRecoveryRepository } from './postgres-submission-recovery-repository.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

integrationDescribe('PostgresSubmissionRecoveryRepository (Integration with PostgreSQL)', () => {
  const db = createKyselyDb(dbUrl);
  const repository = new PostgresSubmissionRecoveryRepository(db);

  async function createTestSubmission(id: string): Promise<void> {
    await db
      .insertInto('targets')
      .values({
        id: 'diplomado-edutec',
        kind: 'academic_offer',
        title: 'Diploma Superior en Educación y Tecnología',
        config_revision: 'v1',
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    await db
      .insertInto('submissions')
      .values({
        id,
        target_id: 'diplomado-edutec',
        config_revision: 'v1',
      })
      .execute();
  }

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('records a new failure with 7-day retention expiry', async () => {
    const submissionId = `sub_rec_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    const now = new Date('2026-10-05T10:00:00.000Z');
    const record = await repository.recordFailure({
      submissionId,
      targetId: 'diplomado-edutec',
      stage: 'sheets',
      safeError: 'Google Sheets 503 Service Unavailable',
      now,
    });

    expect(record).toBeDefined();
    expect(record.submissionId).toBe(submissionId);
    expect(record.targetId).toBe('diplomado-edutec');
    expect(record.stage).toBe('sheets');
    expect(record.status).toBe('pending');
    expect(record.safeError).toBe('Google Sheets 503 Service Unavailable');
    expect(record.attemptCount).toBe(1);
    expect(record.firstFailedAt.toISOString()).toBe(now.toISOString());
    expect(record.lastAttemptAt.toISOString()).toBe(now.toISOString());

    // 7 days retention
    const expectedExpiry = new Date('2026-10-12T10:00:00.000Z');
    expect(record.retentionExpiresAt.toISOString()).toBe(expectedExpiry.toISOString());

    // Repeating recordFailure on the same submission increments attempt count and keeps retention expiry
    const later = new Date('2026-10-05T11:00:00.000Z');
    const updated = await repository.recordFailure({
      submissionId,
      targetId: 'diplomado-edutec',
      stage: 'drive',
      safeError: 'Google Drive quota exceeded',
      now: later,
    });

    expect(updated.id).toBe(record.id);
    expect(updated.attemptCount).toBe(2);
    expect(updated.stage).toBe('drive');
    expect(updated.safeError).toBe('Google Drive quota exceeded');
    expect(updated.firstFailedAt.toISOString()).toBe(now.toISOString());
    expect(updated.lastAttemptAt.toISOString()).toBe(later.toISOString());
    expect(updated.retentionExpiresAt.toISOString()).toBe(expectedExpiry.toISOString());
  });

  it('retains links and unresolved notification recovery past file expiry', async () => {
    const submissionId = `sub_notify_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);
    const record = await repository.recordFailure({
      submissionId, targetId: 'diplomado-edutec', stage: 'notifications', safeError: 'Sin destinatarios',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet/edit',
      documentsFolderUrl: 'https://drive.google.com/drive/folders/folder',
      now: new Date('2026-10-01T00:00:00Z'), retentionDays: 7,
    });
    await repository.deleteExpired(new Date('2026-10-10T00:00:00Z'));
    const retained = await repository.findById(record.id);
    expect(retained).toMatchObject({ status: 'pending', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet/edit', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder' });
  });

  it('lists failed recoveries with filtering and includes file summaries', async () => {
    const submissionId = `sub_rec_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    // Insert associated submission file
    await db
      .insertInto('submission_files')
      .values({
        token: `tok_${crypto.randomUUID().slice(0, 8)}`,
        submission_id: submissionId,
        field_key: 'documento_identidad',
        original_name: 'cedula.pdf',
        mime_type: 'application/pdf',
        size: 1024,
        status: 'pending',
      })
      .execute();

    await repository.recordFailure({
      submissionId,
      targetId: 'diplomado-edutec',
      stage: 'drive',
      safeError: 'Drive timeout',
    });

    const pending = await repository.listFailed({ status: 'pending', stage: 'drive' });
    const found = pending.find((r) => r.submissionId === submissionId);
    expect(found).toBeDefined();

    const detail = await repository.findById(submissionId);
    expect(detail).toBeDefined();
    expect(detail?.files).toHaveLength(1);
    expect(detail?.files?.[0]?.fieldKey).toBe('documento_identidad');
    expect(detail?.files?.[0]?.originalName).toBe('cedula.pdf');
  });

  it('claims and releases lease to prevent concurrent retries', async () => {
    const submissionId = `sub_rec_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    const record = await repository.recordFailure({
      submissionId,
      targetId: 'diplomado-edutec',
      stage: 'sheets',
      safeError: 'Sheets error',
    });

    const now = new Date();
    const leaseMs = 60000;

    // First claim succeeds
    const claimed = await repository.claim(record.id, now, leaseMs, 'worker-1');
    expect(claimed).toBeDefined();
    expect(claimed?.status).toBe('retrying');
    expect(claimed?.lockedBy).toBe('worker-1');
    expect(claimed?.lockedUntil).toBeDefined();

    // Second claim while locked fails
    const concurrentClaim = await repository.claim(record.id, now, leaseMs, 'worker-2');
    expect(concurrentClaim).toBeNull();

    // After release, claim succeeds again
    await repository.release(record.id);
    const reClaimed = await repository.claim(record.id, now, leaseMs, 'worker-2');
    expect(reClaimed).toBeDefined();
    expect(reClaimed?.lockedBy).toBe('worker-2');
  });

  it('marks retry result as resolved or failed', async () => {
    const submissionId = `sub_rec_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    const record = await repository.recordFailure({
      submissionId,
      targetId: 'diplomado-edutec',
      stage: 'sheets',
      safeError: 'Sheets error',
    });

    // Mark retry failed
    await repository.markRetryResult(record.id, {
      success: false,
      stage: 'sheets',
      safeError: 'Sheets append range failed again',
      now: new Date('2026-10-05T12:00:00Z'),
    });

    const afterFailed = await repository.findById(record.id);
    expect(afterFailed?.status).toBe('pending');
    expect(afterFailed?.safeError).toBe('Sheets append range failed again');
    expect(afterFailed?.lockedUntil).toBeNull();

    // Mark retry success
    await repository.markRetryResult(record.id, {
      success: true,
      now: new Date('2026-10-05T12:05:00Z'),
    });

    const afterSuccess = await repository.findById(record.id);
    expect(afterSuccess?.status).toBe('resolved');
    expect(afterSuccess?.resolvedAt).toBeDefined();
    expect(afterSuccess?.lockedUntil).toBeNull();
  });

  it('discards failed recovery with reason and actor', async () => {
    const submissionId = `sub_rec_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    const record = await repository.recordFailure({
      submissionId,
      targetId: 'diplomado-edutec',
      stage: 'drive',
      safeError: 'Unrecoverable corrupted file',
    });

    await repository.discard(record.id, 'admin@flacso.edu.uy', 'Postulante desistió');

    const discarded = await repository.findById(record.id);
    expect(discarded?.status).toBe('discarded');
    expect(discarded?.discardedBy).toBe('admin@flacso.edu.uy');
    expect(discarded?.discardReason).toBe('Postulante desistió');
    expect(discarded?.discardedAt).toBeDefined();
  });

  it('deletes expired recoveries and returns deleted submission IDs', async () => {
    const submissionId = `sub_rec_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    const pastDate = new Date('2026-09-01T10:00:00Z');
    await repository.recordFailure({
      submissionId,
      targetId: 'diplomado-edutec',
      stage: 'drive',
      safeError: 'Old failure',
      now: pastDate,
      retentionDays: 7,
    });

    // Clean up with now = 2026-10-05 (which is well past 2026-09-08 expiry)
    const deleted = await repository.deleteExpired(new Date('2026-10-05T00:00:00Z'));
    expect(deleted).toContain(submissionId);

    const check = await repository.findById(submissionId);
    expect(check).toBeNull();
  });
});
