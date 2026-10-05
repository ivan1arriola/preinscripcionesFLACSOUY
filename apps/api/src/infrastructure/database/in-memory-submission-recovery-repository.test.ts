import { describe, it, expect } from 'vitest';
import { InMemorySubmissionRecoveryRepository } from './in-memory-submission-recovery-repository.js';

describe('InMemorySubmissionRecoveryRepository', () => {
  it('records a new failure with 7-day retention and updates on repeated failure', async () => {
    const repo = new InMemorySubmissionRecoveryRepository();
    const now = new Date('2026-10-05T10:00:00.000Z');

    const record = await repo.recordFailure({
      submissionId: 'sub_test_1',
      targetId: 'diplomado-edutec',
      stage: 'sheets',
      safeError: 'Sheets 503',
      now,
    });

    expect(record.submissionId).toBe('sub_test_1');
    expect(record.attemptCount).toBe(1);
    expect(record.status).toBe('pending');
    expect(record.retentionExpiresAt.toISOString()).toBe('2026-10-12T10:00:00.000Z');

    // Repeated failure
    const later = new Date('2026-10-05T11:00:00.000Z');
    const updated = await repo.recordFailure({
      submissionId: 'sub_test_1',
      targetId: 'diplomado-edutec',
      stage: 'drive',
      safeError: 'Drive timeout',
      now: later,
    });

    expect(updated.id).toBe(record.id);
    expect(updated.attemptCount).toBe(2);
    expect(updated.stage).toBe('drive');
    expect(updated.safeError).toBe('Drive timeout');
    expect(updated.firstFailedAt.toISOString()).toBe(now.toISOString());
    expect(updated.lastAttemptAt.toISOString()).toBe(later.toISOString());
  });

  it('claims, releases, retries and discards correctly', async () => {
    const repo = new InMemorySubmissionRecoveryRepository();
    const now = new Date();

    const record = await repo.recordFailure({
      submissionId: 'sub_test_2',
      targetId: 'diplomado-edutec',
      stage: 'sheets',
      safeError: 'Sheets 500',
      now,
    });

    // Claim
    const claimed = await repo.claim(record.id, now, 60000, 'worker-1');
    expect(claimed?.status).toBe('retrying');
    expect(claimed?.lockedBy).toBe('worker-1');

    // Concurrent claim blocked
    const concurrent = await repo.claim(record.id, now, 60000, 'worker-2');
    expect(concurrent).toBeNull();

    // Release
    await repo.release(record.id);
    const afterRelease = await repo.findById(record.id);
    expect(afterRelease?.status).toBe('pending');
    expect(afterRelease?.lockedUntil).toBeNull();

    // Mark failed
    await repo.markRetryResult(record.id, {
      success: false,
      stage: 'sheets',
      safeError: 'Still failing',
      now: new Date(),
    });
    const afterRetry = await repo.findById(record.id);
    expect(afterRetry?.status).toBe('pending');
    expect(afterRetry?.attemptCount).toBe(2);

    // Discard
    await repo.discard(record.id, 'admin@flacso.edu.uy', 'Discard test');
    const discarded = await repo.findById(record.id);
    expect(discarded?.status).toBe('discarded');
    expect(discarded?.discardedBy).toBe('admin@flacso.edu.uy');
  });

  it('deletes expired records', async () => {
    const repo = new InMemorySubmissionRecoveryRepository();
    const past = new Date('2026-09-01T00:00:00Z');

    await repo.recordFailure({
      submissionId: 'sub_test_expired',
      targetId: 'diplomado-edutec',
      stage: 'drive',
      safeError: 'Past error',
      now: past,
      retentionDays: 7,
    });

    const deleted = await repo.deleteExpired(new Date('2026-10-05T00:00:00Z'));
    expect(deleted).toContain('sub_test_expired');

    const check = await repo.findById('sub_test_expired');
    expect(check).toBeNull();
  });
});
