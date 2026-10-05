import { describe, it, expect } from 'vitest';
import { InMemoryTelegramAlertRepository } from './in-memory-telegram-alert-repository.js';

describe('InMemoryTelegramAlertRepository', () => {
  it('enqueues alerts with default eventType and generated dedupeKey', async () => {
    const repo = new InMemoryTelegramAlertRepository();
    const [alert] = await repo.enqueue({
      submissionId: 'sub_123',
      chatId: '1001',
      message: 'Recovery alert',
    });

    expect(alert).toBeDefined();
    expect(alert.eventType).toBe('recovery');
    expect(alert.dedupeKey).toBe('sub_123:1001:recovery');
  });

  it('ensureForSubmission is idempotent for the same dedupeKey', async () => {
    const repo = new InMemoryTelegramAlertRepository();

    const firstRun = await repo.ensureForSubmission([
      {
        submissionId: 'sub_123',
        chatId: '1001',
        eventType: 'preinscription',
        message: 'Preinscripción 1',
      },
      {
        submissionId: 'sub_123',
        chatId: '1002',
        eventType: 'preinscription',
        message: 'Preinscripción 1',
      },
    ]);

    expect(firstRun).toHaveLength(2);
    expect(repo.alerts).toHaveLength(2);

    // Call again with the same submissionId and chatIds
    const secondRun = await repo.ensureForSubmission([
      {
        submissionId: 'sub_123',
        chatId: '1001',
        eventType: 'preinscription',
        message: 'Preinscripción 1 (duplicate call)',
      },
      {
        submissionId: 'sub_123',
        chatId: '1002',
        eventType: 'preinscription',
        message: 'Preinscripción 1 (duplicate call)',
      },
    ]);

    expect(secondRun).toHaveLength(2);
    // Must return the exact same IDs
    expect(secondRun.map((a) => a.id)).toEqual(firstRun.map((a) => a.id));
    // No new alerts added
    expect(repo.alerts).toHaveLength(2);
  });

  it('allows distinct event types for the same submission and chat', async () => {
    const repo = new InMemoryTelegramAlertRepository();

    const [preinscription] = await repo.ensureForSubmission({
      submissionId: 'sub_123',
      chatId: '1001',
      eventType: 'preinscription',
      message: 'Preinscripción',
    });

    const [recovery] = await repo.ensureForSubmission({
      submissionId: 'sub_123',
      chatId: '1001',
      eventType: 'recovery',
      message: 'Alerta recuperación',
    });

    expect(preinscription.id).not.toBe(recovery.id);
    expect(preinscription.eventType).toBe('preinscription');
    expect(recovery.eventType).toBe('recovery');
    expect(repo.alerts).toHaveLength(2);
  });

  it('filters alerts by eventType', async () => {
    const repo = new InMemoryTelegramAlertRepository();

    await repo.ensureForSubmission([
      {
        submissionId: 'sub_1',
        chatId: '1001',
        eventType: 'preinscription',
        message: 'Preinscripción 1',
      },
      {
        submissionId: 'sub_2',
        chatId: '1001',
        eventType: 'recovery',
        message: 'Recuperación 2',
      },
    ]);

    const preinscriptions = await repo.listAlerts({ eventType: 'preinscription' });
    expect(preinscriptions).toHaveLength(1);
    expect(preinscriptions[0]!.submissionId).toBe('sub_1');

    const recoveries = await repo.listAlerts({ eventType: 'recovery' });
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]!.submissionId).toBe('sub_2');
  });
});
