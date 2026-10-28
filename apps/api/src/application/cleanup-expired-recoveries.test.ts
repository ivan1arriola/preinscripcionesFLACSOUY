import { describe, it, expect, vi } from 'vitest';
import { InMemorySubmissionRecoveryRepository } from '../infrastructure/database/in-memory-submission-recovery-repository.js';
import { cleanupExpiredRecoveries } from './cleanup-expired-recoveries.js';

describe('cleanupExpiredRecoveries', () => {
  it('keeps unresolved notification failures visible after temporary-file retention expires', async () => {
    const repo = new InMemorySubmissionRecoveryRepository();
    const record = await repo.recordFailure({ submissionId: 'sub-notify', targetId: 'target', stage: 'notifications', safeError: 'Sin destinatarios', now: new Date('2026-10-01T00:00:00Z'), retentionDays: 7 });
    await cleanupExpiredRecoveries({ recoveryRepository: repo }, new Date('2026-10-10T00:00:00Z'));
    expect((await repo.findById(record.id))?.status).toBe('pending');
  });

  it('cleans expired recoveries and calls file storage cleanup idempotently', async () => {
    const recoveryRepo = new InMemorySubmissionRecoveryRepository();
    const mockStorage = {
      cleanup: vi.fn(async () => 2),
      save: vi.fn(),
      open: vi.fn(),
      remove: vi.fn(),
    };

    const now = new Date('2026-10-10T12:00:00Z');
    const past = new Date('2026-10-01T12:00:00Z');

    // Create 1 expired and 1 active recovery
    const expiredRecord = await recoveryRepo.recordFailure({
      submissionId: 'sub_expired_1',
      targetId: 'diploma-genero',
      stage: 'drive',
      safeError: 'Drive failure',
      now: past,
      retentionDays: 7, // expires at 2026-10-08, before now
    });

    const activeRecord = await recoveryRepo.recordFailure({
      submissionId: 'sub_active_1',
      targetId: 'diploma-genero',
      stage: 'sheets',
      safeError: 'Sheets failure',
      now: past,
      retentionDays: 30, // expires in the future
    });

    const result = await cleanupExpiredRecoveries(
      {
        recoveryRepository: recoveryRepo,
        fileStorage: mockStorage as any,
      },
      now
    );

    expect(result.deletedRecoveries).toBe(1);
    expect(result.removedFiles).toBe(2);
    expect(mockStorage.cleanup).toHaveBeenCalledWith(now.getTime());

    // Expired record should be gone
    expect(await recoveryRepo.findById(expiredRecord.id)).toBeNull();
    // Active record should remain
    expect(await recoveryRepo.findById(activeRecord.id)).not.toBeNull();

    // Second run should be idempotent
    mockStorage.cleanup.mockResolvedValueOnce(0);
    const secondResult = await cleanupExpiredRecoveries(
      {
        recoveryRepository: recoveryRepo,
        fileStorage: mockStorage as any,
      },
      now
    );
    expect(secondResult.deletedRecoveries).toBe(0);
    expect(secondResult.removedFiles).toBe(0);
  });
});
