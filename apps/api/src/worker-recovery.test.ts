import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramRecoveryAlertDispatcher } from './application/telegram-recovery-alert-dispatcher.js';
import { InMemoryTelegramAlertRepository } from './infrastructure/database/in-memory-telegram-alert-repository.js';
import { InMemorySubmissionRecoveryRepository } from './infrastructure/database/in-memory-submission-recovery-repository.js';
import { cleanupExpiredRecoveries } from './application/cleanup-expired-recoveries.js';

describe('Worker Recovery & Telegram Alerts', () => {
  let alertRepo: InMemoryTelegramAlertRepository;
  let recoveryRepo: InMemorySubmissionRecoveryRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    alertRepo = new InMemoryTelegramAlertRepository();
    recoveryRepo = new InMemorySubmissionRecoveryRepository();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves queued alerts pending when Telegram configuration is disabled or incomplete without noisy failures', async () => {
    // Enqueue an alert
    const [alert] = await alertRepo.enqueue({
      submissionId: 'sub_test_disabled',
      chatId: '-100987654321',
      message: 'Alerta incidente técnico',
    });

    const getProvider = vi.fn(async () => null); // Disabled/unconfigured provider

    const dispatcher = new TelegramRecoveryAlertDispatcher({
      repository: alertRepo,
      getProvider,
    });

    // Start dispatcher with 10s interval
    const runner = dispatcher.start(10_000);

    // Initial tick runs immediately
    await vi.advanceTimersByTimeAsync(0);

    expect(getProvider).toHaveBeenCalled();
    const fetched = await alertRepo.findById(alert!.id);
    // Alert should have been rescheduled (retryable failure) rather than permanently failed
    expect(fetched?.status).toBe('pending');
    expect(fetched?.lastError).toContain('Telegram no está configurado o está deshabilitado.');

    // Stop cleanly
    runner.stop();
  });

  it('dispatches queued alerts when Telegram configuration is enabled and provider is available', async () => {
    const [alert] = await alertRepo.enqueue({
      submissionId: 'sub_test_active',
      chatId: '-100987654321',
      message: 'Alerta incidente activo',
    });

    const mockProvider = {
      verify: vi.fn(async () => undefined),
      send: vi.fn(async () => ({ providerMessageId: 'tg-msg-456' })),
    };

    const dispatcher = new TelegramRecoveryAlertDispatcher({
      repository: alertRepo,
      getProvider: async () => mockProvider,
    });

    const runner = dispatcher.start(10_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockProvider.send).toHaveBeenCalledWith('Alerta incidente activo', '-100987654321');

    const fetched = await alertRepo.findById(alert!.id);
    expect(fetched?.status).toBe('sent');
    expect(fetched?.providerMessageId).toBe('tg-msg-456');

    runner.stop();
  });

  it('runs retention cleanup and removes expired records and files', async () => {
    const mockStorage = {
      cleanup: vi.fn(async () => 3),
      open: vi.fn(),
      save: vi.fn(),
      remove: vi.fn(),
    };

    const past = new Date('2026-09-01T00:00:00Z');
    const now = new Date('2026-10-01T00:00:00Z');

    const expired = await recoveryRepo.recordFailure({
      submissionId: 'sub_worker_expired',
      targetId: 'diplomado-salud-c2',
      stage: 'drive',
      safeError: 'Timeout',
      now: past,
      retentionDays: 7,
    });

    const result = await cleanupExpiredRecoveries(
      {
        recoveryRepository: recoveryRepo,
        fileStorage: mockStorage as any,
      },
      now
    );

    expect(result.deletedRecoveries).toBe(1);
    expect(result.removedFiles).toBe(3);
    expect(await recoveryRepo.findById(expired.id)).toBeNull();
  });
});
