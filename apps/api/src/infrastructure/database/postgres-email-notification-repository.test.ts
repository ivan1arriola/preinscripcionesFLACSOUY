import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createKyselyDb } from './kysely.js';
import { runMigrations } from './migrate.js';
import { PostgresEmailNotificationRepository } from './postgres-email-notification-repository.js';
import type { SubmissionNotificationSnapshot } from '../../application/notification-snapshot.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

integrationDescribe('PostgresEmailNotificationRepository (Integration with PostgreSQL)', () => {
  const db = createKyselyDb(dbUrl);
  const repository = new PostgresEmailNotificationRepository(db);

  const sampleSnapshot: SubmissionNotificationSnapshot = {
    submissionId: '',
    targetId: 'diplomado-edutec',
    targetTitle: 'Diploma Superior en Educación y Tecnología',
    targetKind: 'academic_offer',
    applicantEmail: 'postulante@example.com',
    applicantName: 'Ana Clara',
    notificationEmail: 'coordinacion@flacso.edu.uy',
    values: {
      nombre: { key: 'nombre', label: 'Nombre', value: 'Ana' },
      apellido: { key: 'apellido', label: 'Apellido', value: 'Clara' },
    },
    orderedFieldKeys: ['nombre', 'apellido'],
    spreadsheetRowUrl: 'https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0&range=A5:E5',
    documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-abc',
    templateVersion: 'preinscription-notification-v1',
  };

  async function createTestSubmission(id: string): Promise<void> {
    // Insert target if not exists
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

    // Insert submission
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

  beforeEach(async () => {
    await db.deleteFrom('email_notifications').execute();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('ensures notifications idempotently without duplicating deliveries', async () => {
    const submissionId = `sub_notif_test_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    const snapshot = { ...sampleSnapshot, submissionId };
    const now = new Date('2026-10-04T15:00:00Z');

    const first = await repository.ensureForSubmission({
      submissionId,
      snapshot,
      availableAt: now,
      recipients: [
        { audience: 'applicant', email: '  POSTULANTE@EXAMPLE.COM ' },
        { audience: 'target', email: 'coordinacion@flacso.edu.uy' },
      ],
    });

    expect(first).toHaveLength(2);
    expect(first[0]?.recipientEmail).toBe('postulante@example.com');
    expect(first[0]?.status).toBe('pending');
    expect(first[0]?.attemptCount).toBe(0);

    // Call again with same submission
    const second = await repository.ensureForSubmission({
      submissionId,
      snapshot,
      availableAt: now,
      recipients: [
        { audience: 'applicant', email: 'postulante@example.com' },
        { audience: 'target', email: 'coordinacion@flacso.edu.uy' },
      ],
    });

    expect(second).toHaveLength(2);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[1]?.id).toBe(first[1]?.id);

    // Check directly in database
    const dbRows = await db
      .selectFrom('email_notifications')
      .selectAll()
      .where('submission_id', '=', submissionId)
      .execute();

    expect(dbRows).toHaveLength(2);
  });

  it('claims pending jobs respecting lease duration and skipping locked records', async () => {
    const submissionId = `sub_notif_claim_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    const snapshot = { ...sampleSnapshot, submissionId };
    const now = new Date('2026-10-04T16:00:00Z');

    await repository.ensureForSubmission({
      submissionId,
      snapshot,
      availableAt: now,
      recipients: [
        { audience: 'applicant', email: 'applicant-claim@example.com' },
        { audience: 'target', email: 'target-claim@flacso.edu.uy' },
      ],
    });

    // Claim 1 item
    const claimed = await repository.claimPending(1, now, 60_000);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe('processing');
    expect(claimed[0]?.attemptCount).toBe(1);
    expect(claimed[0]?.lockedUntil).toBeDefined();

    // Another claim at same time should not claim the same record
    const secondClaim = await repository.claimPending(1, now, 60_000);
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]?.id).not.toBe(claimed[0]?.id);

    // Third claim returns empty
    const thirdClaim = await repository.claimPending(1, now, 60_000);
    expect(thirdClaim).toHaveLength(0);

    // Claim after lease expired
    const afterLease = new Date('2026-10-04T16:05:00Z');
    const expiredClaim = await repository.claimPending(1, afterLease, 60_000);
    expect(expiredClaim.length).toBeGreaterThanOrEqual(1);
  });

  it('handles state transitions: markSent, markRetryableFailure, markPermanentFailure, resetForManualRetry', async () => {
    const submissionId = `sub_notif_state_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(submissionId);

    const snapshot = { ...sampleSnapshot, submissionId };
    const now = new Date('2026-10-04T17:00:00Z');

    const [job] = await repository.ensureForSubmission({
      submissionId,
      snapshot,
      availableAt: now,
      recipients: [{ audience: 'applicant', email: 'applicant-state@example.com' }],
    });

    if (!job) throw new Error('Job was not created');

    // 1. Mark sent
    await repository.markSent(job.id, 'ses-test-id-999', now);
    let current = await repository.findById(job.id);
    expect(current?.status).toBe('sent');
    expect(current?.providerMessageId).toBe('ses-test-id-999');

    // 2. Mark retryable failure
    const retryAt = new Date('2026-10-04T17:10:00Z');
    await repository.markRetryableFailure(job.id, 'Temporary Network Error', retryAt);
    current = await repository.findById(job.id);
    expect(current?.status).toBe('pending');
    expect(current?.lastError).toBe('Temporary Network Error');
    expect(current?.availableAt).toEqual(retryAt);

    // 3. Mark permanent failure
    await repository.markPermanentFailure(job.id, 'Account Suspended', now);
    current = await repository.findById(job.id);
    expect(current?.status).toBe('failed');
    expect(current?.lastError).toBe('Account Suspended');

    // 4. Reset for manual retry with updated email
    await repository.resetForManualRetry(job.id, new Date('2026-10-04T17:20:00Z'), 'corrected-postgres@example.com');
    current = await repository.findById(job.id);
    expect(current?.status).toBe('pending');
    expect(current?.recipientEmail).toBe('corrected-postgres@example.com');
    expect(current?.availableAt).toEqual(new Date('2026-10-04T17:20:00Z'));

    // 5. Mark unknown
    await repository.markUnknown(job.id, 'Network timeout awaiting SES response');
    current = await repository.findById(job.id);
    expect(current?.status).toBe('unknown');
    expect(current?.lastError).toBe('Network timeout awaiting SES response');

    // 6. getCounts
    const counts = await repository.getCounts();
    expect(counts.total).toBeGreaterThanOrEqual(1);
    expect(counts.unknown).toBeGreaterThanOrEqual(1);
  });

  it('lists missing notifications for successful submissions', async () => {
    const successfulSubmissionId = `sub_succ_${crypto.randomUUID().slice(0, 8)}`;
    await createTestSubmission(successfulSubmissionId);

    // Insert successful processing
    await db
      .insertInto('submission_processing')
      .values({
        submission_id: successfulSubmissionId,
        status: 'success',
      })
      .execute();

    const missing = await repository.listMissingForSuccessfulSubmissions(10);
    expect(missing).toContain(successfulSubmissionId);

    // Once we ensure notifications for it, it should no longer be missing
    await repository.ensureForSubmission({
      submissionId: successfulSubmissionId,
      snapshot: { ...sampleSnapshot, submissionId: successfulSubmissionId },
      recipients: [{ audience: 'applicant', email: 'applicant@example.com' }],
    });

    const missingAfter = await repository.listMissingForSuccessfulSubmissions(10);
    expect(missingAfter).not.toContain(successfulSubmissionId);
  });
});
