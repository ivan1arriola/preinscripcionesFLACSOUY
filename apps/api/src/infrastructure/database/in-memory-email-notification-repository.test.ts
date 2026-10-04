import { describe, expect, it } from 'vitest';
import { InMemoryEmailNotificationRepository } from './in-memory-email-notification-repository.js';
import type { SubmissionNotificationSnapshot } from '../../application/notification-snapshot.js';

describe('InMemoryEmailNotificationRepository', () => {
  const sampleSnapshot: SubmissionNotificationSnapshot = {
    submissionId: 'sub_test_100',
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

  it('enqueues notifications for each recipient and handles idempotency', async () => {
    const repo = new InMemoryEmailNotificationRepository();

    const created = await repo.ensureForSubmission({
      submissionId: 'sub_test_100',
      snapshot: sampleSnapshot,
      recipients: [
        { audience: 'applicant', email: '  POSTULANTE@EXAMPLE.COM ' },
        { audience: 'target', email: 'coordinacion@flacso.edu.uy' },
        { audience: 'master', email: 'admin@flacso.edu.uy' },
      ],
    });

    expect(created).toHaveLength(3);
    expect(created.map((c) => c.audience)).toEqual(['applicant', 'target', 'master']);
    expect(created[0]?.recipientEmail).toBe('postulante@example.com');
    expect(created[0]?.status).toBe('pending');
    expect(created[0]?.attemptCount).toBe(0);

    // Call again with same parameters
    const secondCall = await repo.ensureForSubmission({
      submissionId: 'sub_test_100',
      snapshot: sampleSnapshot,
      recipients: [
        { audience: 'applicant', email: 'postulante@example.com' },
        { audience: 'target', email: 'coordinacion@flacso.edu.uy' },
        { audience: 'master', email: 'admin@flacso.edu.uy' },
      ],
    });

    expect(secondCall).toHaveLength(3);
    expect(secondCall[0]?.id).toBe(created[0]?.id);
    expect(secondCall[1]?.id).toBe(created[1]?.id);
    expect(secondCall[2]?.id).toBe(created[2]?.id);

    // Verify all in repository
    const all = await repo.listNotifications();
    expect(all).toHaveLength(3);
  });

  it('claims pending jobs respecting lease duration and prevents concurrent double claim', async () => {
    const repo = new InMemoryEmailNotificationRepository();
    const now = new Date('2026-10-04T12:00:00Z');

    await repo.ensureForSubmission({
      submissionId: 'sub_test_100',
      snapshot: sampleSnapshot,
      availableAt: now,
      recipients: [
        { audience: 'applicant', email: 'postulante@example.com' },
        { audience: 'target', email: 'coordinacion@flacso.edu.uy' },
      ],
    });

    // Claim 1 item
    const claimed = await repo.claimPending(1, now, 60_000); // 1 min lease
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe('processing');
    expect(claimed[0]?.attemptCount).toBe(1);
    expect(claimed[0]?.lockedUntil).toEqual(new Date('2026-10-04T12:01:00Z'));

    // Immediate second claim at same time should claim the second item, not the first
    const secondClaim = await repo.claimPending(2, now, 60_000);
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]?.id).not.toBe(claimed[0]?.id);

    // Third claim should be empty since all are locked
    const thirdClaim = await repo.claimPending(2, now, 60_000);
    expect(thirdClaim).toHaveLength(0);

    // After lease expires (at 12:02:00Z), first claimed job can be claimed again if not finished
    const later = new Date('2026-10-04T12:02:00Z');
    const expiredClaim = await repo.claimPending(1, later, 60_000);
    expect(expiredClaim).toHaveLength(1);
    expect(expiredClaim[0]?.id).toBe(claimed[0]?.id);
    expect(expiredClaim[0]?.attemptCount).toBe(2);
  });

  it('tracks execution state transitions: markSent, markRetryableFailure, markPermanentFailure, markUnknown', async () => {
    const repo = new InMemoryEmailNotificationRepository();
    const now = new Date('2026-10-04T12:00:00Z');

    const [job] = await repo.ensureForSubmission({
      submissionId: 'sub_test_100',
      snapshot: sampleSnapshot,
      recipients: [{ audience: 'applicant', email: 'postulante@example.com' }],
    });

    if (!job) throw new Error('Job not created');

    // 1. Mark sent
    await repo.markSent(job.id, 'ses-msg-id-12345', now);
    const sent = await repo.findById(job.id);
    expect(sent?.status).toBe('sent');
    expect(sent?.providerMessageId).toBe('ses-msg-id-12345');
    expect(sent?.sentAt).toEqual(now);
    expect(sent?.lockedUntil).toBeUndefined();

    // 2. Mark retryable failure
    const retryAt = new Date('2026-10-04T12:05:00Z');
    await repo.markRetryableFailure(job.id, 'ThrottlingException', retryAt);
    const retryable = await repo.findById(job.id);
    expect(retryable?.status).toBe('pending');
    expect(retryable?.lastError).toBe('ThrottlingException');
    expect(retryable?.availableAt).toEqual(retryAt);
    expect(retryable?.lockedUntil).toBeUndefined();

    // 3. Mark permanent failure
    await repo.markPermanentFailure(job.id, 'InvalidParameterException', now);
    const failed = await repo.findById(job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.lastError).toBe('InvalidParameterException');
    expect(failed?.lockedUntil).toBeUndefined();

    // 4. Reset for manual retry
    await repo.resetForManualRetry(job.id, new Date('2026-10-04T12:10:00Z'));
    const reset = await repo.findById(job.id);
    expect(reset?.status).toBe('pending');
    expect(reset?.availableAt).toEqual(new Date('2026-10-04T12:10:00Z'));

    // 5. Mark unknown
    await repo.markUnknown(job.id, 'Timeout without confirmation');
    const unknown = await repo.findById(job.id);
    expect(unknown?.status).toBe('unknown');
    expect(unknown?.lastError).toBe('Timeout without confirmation');
  });
});
