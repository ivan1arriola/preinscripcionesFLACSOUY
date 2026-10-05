import { describe, it, expect, beforeEach } from 'vitest';
import { TelegramRecoveryAlertDispatcher } from './telegram-recovery-alert-dispatcher.js';
import { InMemoryTelegramAlertRepository } from '../infrastructure/database/in-memory-telegram-alert-repository.js';
import type { TelegramProvider } from '../ports/telegram-provider.js';

describe('TelegramRecoveryAlertDispatcher', () => {
  let repository: InMemoryTelegramAlertRepository;

  beforeEach(() => {
    repository = new InMemoryTelegramAlertRepository();
  });

  it('dispatches pending alerts successfully', async () => {
    await repository.enqueue([
      { submissionId: 'sub_1', chatId: '111', message: 'Alerta 1' },
      { submissionId: 'sub_1', chatId: '222', message: 'Alerta 1' },
    ]);

    const sentCalls: Array<{ message: string; chatId: string }> = [];
    const mockProvider: TelegramProvider = {
      verify: async () => undefined,
      send: async (msg, chat) => {
        sentCalls.push({ message: msg, chatId: chat });
        return { providerMessageId: `msg_${chat}` };
      },
    };

    const dispatcher = new TelegramRecoveryAlertDispatcher({
      repository,
      provider: mockProvider,
    });

    const now = new Date();
    const result = await dispatcher.dispatchBatch(now);

    expect(result.claimed).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);

    const counts = await repository.getCounts();
    expect(counts.sent).toBe(2);
    expect(counts.pending).toBe(0);

    const alerts = await repository.listAlerts();
    expect(alerts.every((a) => a.status === 'sent')).toBe(true);
    expect(alerts.find((a) => a.chatId === '111')?.providerMessageId).toBe('msg_111');
    expect(alerts.find((a) => a.chatId === '222')?.providerMessageId).toBe('msg_222');
  });

  it('isolates failure between multiple recipients and applies retry backoff', async () => {
    await repository.enqueue([
      { submissionId: 'sub_2', chatId: 'good_chat', message: 'Alerta 2' },
      { submissionId: 'sub_2', chatId: 'bad_chat', message: 'Alerta 2' },
    ]);

    const mockProvider: TelegramProvider = {
      verify: async () => undefined,
      send: async (_msg, chat) => {
        if (chat === 'bad_chat') {
          throw new Error('Telegram error: Rate limit exceeded (429)');
        }
        return { providerMessageId: 'ok_msg' };
      },
    };

    const dispatcher = new TelegramRecoveryAlertDispatcher({
      repository,
      provider: mockProvider,
    });

    const now = new Date();
    const result = await dispatcher.dispatchBatch(now);

    expect(result.claimed).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);

    const goodAlert = repository.alerts.find((a) => a.chatId === 'good_chat');
    const badAlert = repository.alerts.find((a) => a.chatId === 'bad_chat');

    expect(goodAlert?.status).toBe('sent');
    expect(badAlert?.status).toBe('pending');
    expect(badAlert?.attemptCount).toBe(1);
    expect(badAlert?.lastError).toContain('Rate limit exceeded');
    expect(badAlert?.availableAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('marks alert as permanent failure when max attempts reached or permanent error', async () => {
    const [alert] = await repository.enqueue({
      submissionId: 'sub_3',
      chatId: 'invalid_chat',
      message: 'Alerta 3',
      maxAttempts: 2,
    });
    expect(alert).toBeDefined();

    const mockProvider: TelegramProvider = {
      verify: async () => undefined,
      send: async () => {
        throw new Error('Telegram error: chat not found');
      },
    };

    const dispatcher = new TelegramRecoveryAlertDispatcher({
      repository,
      provider: mockProvider,
    });

    // Permanent error (chat not found) should fail permanently immediately
    const now = new Date();
    await dispatcher.dispatchBatch(now);

    const updated = await repository.findById(alert!.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.lastError).toContain('chat not found');
  });

  it('marks permanent failure when max attempts exceeded for transient error', async () => {
    const [alert] = await repository.enqueue({
      submissionId: 'sub_4',
      chatId: 'timeout_chat',
      message: 'Alerta 4',
      maxAttempts: 1,
    });
    expect(alert).toBeDefined();

    const mockProvider: TelegramProvider = {
      verify: async () => undefined,
      send: async () => {
        throw new Error('Telegram error: Tiempo de espera agotado');
      },
    };

    const dispatcher = new TelegramRecoveryAlertDispatcher({
      repository,
      provider: mockProvider,
    });

    const now = new Date();
    await dispatcher.dispatchBatch(now);

    const updated = await repository.findById(alert!.id);
    expect(updated?.status).toBe('failed');
  });

  it('does nothing and does not fail when provider is unconfigured/disabled', async () => {
    await repository.enqueue({
      submissionId: 'sub_5',
      chatId: '123',
      message: 'Alerta 5',
    });

    const dispatcher = new TelegramRecoveryAlertDispatcher({
      repository,
      getProvider: async () => null, // Not configured
    });

    const now = new Date();
    const result = await dispatcher.dispatchBatch(now);

    expect(result.claimed).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);

    const alert = repository.alerts[0];
    expect(alert).toBeDefined();
    expect(alert!.status).toBe('pending');
    expect(alert!.availableAt.getTime()).toBeGreaterThan(now.getTime());
  });
});
