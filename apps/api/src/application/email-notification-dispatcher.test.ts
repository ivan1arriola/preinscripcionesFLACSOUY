import { describe, expect, it, vi } from 'vitest';
import {
  EmailNotificationDispatcher,
  calculateBackoffMs,
} from './email-notification-dispatcher.js';
import { InMemoryEmailNotificationRepository } from '../infrastructure/database/in-memory-email-notification-repository.js';
import { SesEmailProviderError, type EmailProvider } from '../infrastructure/email/ses-client.js';
import type { SubmissionNotificationSnapshot } from './notification-snapshot.js';

describe('EmailNotificationDispatcher', () => {
  const sampleSnapshot: SubmissionNotificationSnapshot = {
    submissionId: 'sub_dispatch_1',
    targetId: 'diplomado-edutec',
    targetTitle: 'Diploma Superior en Educación y Tecnología',
    targetKind: 'academic_offer',
    applicantEmail: 'postulante@example.com',
    applicantName: 'Lucía Méndez',
    notificationEmail: 'edutec@flacso.edu.uy',
    values: {
      nombre: { key: 'nombre', label: 'Nombre', value: 'Lucía' },
    },
    orderedFieldKeys: ['nombre'],
    spreadsheetRowUrl: 'https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0&range=A5:E5',
    documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-abc',
    templateVersion: 'preinscription-notification-v1',
  };

  describe('calculateBackoffMs', () => {
    it('returns 1m for attempt 1, 5m for attempt 2, 30m for attempt 3, and 2h for attempt 4+', () => {
      expect(calculateBackoffMs(1)).toBe(60_000);
      expect(calculateBackoffMs(2)).toBe(300_000);
      expect(calculateBackoffMs(3)).toBe(1_800_000);
      expect(calculateBackoffMs(4)).toBe(7_200_000);
      expect(calculateBackoffMs(5)).toBe(7_200_000);
    });
  });

  it('dispatches applicant notification successfully and marks job sent with providerMessageId', async () => {
    const repository = new InMemoryEmailNotificationRepository();
    const now = new Date('2026-10-04T12:00:00Z');

    const [job] = await repository.ensureForSubmission({
      submissionId: 'sub_dispatch_1',
      snapshot: sampleSnapshot,
      availableAt: now,
      recipients: [{ audience: 'applicant', email: 'postulante@example.com' }],
    });

    const mockProvider: EmailProvider = {
      send: vi.fn().mockResolvedValue({ providerMessageId: 'ses-msg-12345' }),
    };

    const dispatcher = new EmailNotificationDispatcher(repository, mockProvider);
    const result = await dispatcher.dispatchPending(now);

    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    const updatedJob = await repository.findById(job!.id);
    expect(updatedJob?.status).toBe('sent');
    expect(updatedJob?.providerMessageId).toBe('ses-msg-12345');
    expect(updatedJob?.sentAt).toEqual(now);

    expect(mockProvider.send).toHaveBeenCalledTimes(1);
    const callArgs = (mockProvider.send as any).mock.calls[0][0];
    expect(callArgs.to).toEqual(['postulante@example.com']);
    expect(callArgs.subject).toContain('Confirmación de preinscripción');
    expect(callArgs.tags).toEqual({
      submissionId: 'sub_dispatch_1',
      targetId: 'diplomado-edutec',
      audience: 'applicant',
    });
  });

  it('dispatches operational notification successfully with Sheets and Drive links', async () => {
    const repository = new InMemoryEmailNotificationRepository();
    const now = new Date('2026-10-04T12:00:00Z');

    const [job] = await repository.ensureForSubmission({
      submissionId: 'sub_dispatch_1',
      snapshot: sampleSnapshot,
      availableAt: now,
      recipients: [{ audience: 'target', email: 'edutec@flacso.edu.uy' }],
    });

    const mockProvider: EmailProvider = {
      send: vi.fn().mockResolvedValue({ providerMessageId: 'ses-msg-op-999' }),
    };

    const dispatcher = new EmailNotificationDispatcher(repository, mockProvider);
    const result = await dispatcher.dispatchPending(now);

    expect(result.sent).toBe(1);
    const updatedJob = await repository.findById(job!.id);
    expect(updatedJob?.status).toBe('sent');

    const callArgs = (mockProvider.send as any).mock.calls[0][0];
    expect(callArgs.to).toEqual(['edutec@flacso.edu.uy']);
    expect(callArgs.text).toContain('Planilla Google Sheets');
    expect(callArgs.text).toContain('Carpeta Google Drive');
  });

  it('handles transient errors by calculating backoff and scheduling retry', async () => {
    const repository = new InMemoryEmailNotificationRepository();
    const now = new Date('2026-10-04T12:00:00Z');

    const [job] = await repository.ensureForSubmission({
      submissionId: 'sub_dispatch_1',
      snapshot: sampleSnapshot,
      availableAt: now,
      recipients: [{ audience: 'applicant', email: 'postulante@example.com' }],
    });

    const mockProvider: EmailProvider = {
      send: vi.fn().mockRejectedValue(
        new SesEmailProviderError('Rate exceeded (TooManyRequestsException)', undefined, true)
      ),
    };

    const dispatcher = new EmailNotificationDispatcher(repository, mockProvider);
    const result = await dispatcher.dispatchPending(now);

    expect(result.processed).toBe(1);
    expect(result.retryable).toBe(1);
    expect(result.sent).toBe(0);

    const updatedJob = await repository.findById(job!.id);
    expect(updatedJob?.status).toBe('pending');
    expect(updatedJob?.lastError).toContain('TooManyRequestsException');
    // First retry backoff: 60s
    expect(updatedJob?.availableAt).toEqual(new Date('2026-10-04T12:01:00Z'));
    expect(updatedJob?.attemptCount).toBe(1);
  });

  it('marks job as permanent failure when maxAttempts is reached', async () => {
    const repository = new InMemoryEmailNotificationRepository();
    let currentTime = new Date('2026-10-04T12:00:00Z');

    const [job] = await repository.ensureForSubmission({
      submissionId: 'sub_dispatch_1',
      snapshot: sampleSnapshot,
      availableAt: currentTime,
      recipients: [{ audience: 'applicant', email: 'postulante@example.com' }],
    });

    const mockProvider: EmailProvider = {
      send: vi.fn().mockRejectedValue(
        new SesEmailProviderError('Rate exceeded (TooManyRequestsException)', undefined, true)
      ),
    };

    const dispatcher = new EmailNotificationDispatcher(repository, mockProvider, { maxAttempts: 3 });

    // Attempt 1: retryable
    const res1 = await dispatcher.dispatchPending(currentTime);
    expect(res1.retryable).toBe(1);

    // Attempt 2: at +60s
    currentTime = new Date(currentTime.getTime() + 61_000);
    const res2 = await dispatcher.dispatchPending(currentTime);
    expect(res2.retryable).toBe(1);

    // Attempt 3: at +300s -> reaches maxAttempts (3) and fails permanently
    currentTime = new Date(currentTime.getTime() + 301_000);
    const res3 = await dispatcher.dispatchPending(currentTime);
    expect(res3.failed).toBe(1);
    expect(res3.retryable).toBe(0);

    const updatedJob = await repository.findById(job!.id);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.attemptCount).toBe(3);
    expect(updatedJob?.lastError).toContain('Excedido el límite de reintentos (3)');
  });

  it('marks job as permanent failure immediately on non-transient error', async () => {
    const repository = new InMemoryEmailNotificationRepository();
    const now = new Date('2026-10-04T12:00:00Z');

    const [job] = await repository.ensureForSubmission({
      submissionId: 'sub_dispatch_1',
      snapshot: sampleSnapshot,
      availableAt: now,
      recipients: [{ audience: 'applicant', email: 'postulante@example.com' }],
    });

    const mockProvider: EmailProvider = {
      send: vi.fn().mockRejectedValue(
        new SesEmailProviderError('Dirección no verificada (MailFromDomainNotVerifiedException)', undefined, false)
      ),
    };

    const dispatcher = new EmailNotificationDispatcher(repository, mockProvider);
    const result = await dispatcher.dispatchPending(now);

    expect(result.failed).toBe(1);
    const updatedJob = await repository.findById(job!.id);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.lastError).toContain('MailFromDomainNotVerifiedException');
  });

  it('marks job as unknown when error is unexpected without confirmation', async () => {
    const repository = new InMemoryEmailNotificationRepository();
    const now = new Date('2026-10-04T12:00:00Z');

    const [job] = await repository.ensureForSubmission({
      submissionId: 'sub_dispatch_1',
      snapshot: sampleSnapshot,
      availableAt: now,
      recipients: [{ audience: 'applicant', email: 'postulante@example.com' }],
    });

    const mockProvider: EmailProvider = {
      send: vi.fn().mockRejectedValue(new Error('Connection reset by peer after sending')),
    };

    const dispatcher = new EmailNotificationDispatcher(repository, mockProvider);
    const result = await dispatcher.dispatchPending(now);

    expect(result.unknown).toBe(1);
    const updatedJob = await repository.findById(job!.id);
    expect(updatedJob?.status).toBe('unknown');
    expect(updatedJob?.lastError).toBe('Connection reset by peer after sending');
  });
});
