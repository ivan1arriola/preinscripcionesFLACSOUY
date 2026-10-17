import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { runMigrations } from './migrate.js';
import { PostgresTelegramAlertRepository } from './postgres-telegram-alert-repository.js';
import type { DatabaseSchema } from './schema.js';
import type { Kysely } from 'kysely';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

integrationDescribe('PostgresTelegramAlertRepository (Integration)', () => {
  let db: Kysely<DatabaseSchema>;
  let repository: PostgresTelegramAlertRepository;
  const testSubId = `sub_test_${Date.now()}`;

  beforeAll(async () => {
    db = createKyselyDb(dbUrl);
    await runMigrations(db);
    repository = new PostgresTelegramAlertRepository(db);
    await db.deleteFrom('telegram_recovery_alerts').execute();

    // Create a target and submission for foreign key constraint
    await db
      .insertInto('targets')
      .values({
        id: 'target-tg-test',
        kind: 'course',
        title: 'Curso Telegram Test',
        config_revision: 'rev-1',
        updated_at: new Date(),
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    await db
      .insertInto('submissions')
      .values({
        id: testSubId,
        target_id: 'target-tg-test',
        config_revision: 'rev-1',
        submitted_at: new Date(),
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom('telegram_recovery_alerts').where('submission_id', '=', testSubId).execute();
    await db.deleteFrom('submissions').where('id', '=', testSubId).execute();
    await db.destroy();
  });

  it('enqueues alerts and counts them correctly', async () => {
    const alerts = await repository.enqueue([
      {
        submissionId: testSubId,
        chatId: '10001',
        message: 'Alerta incidente 1',
      },
      {
        submissionId: testSubId,
        chatId: '10002',
        message: 'Alerta incidente 2',
      },
    ]);

    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.chatId).toBe('10001');
    expect(alerts[0]!.status).toBe('pending');

    const counts = await repository.getCounts();
    expect(counts.pending).toBeGreaterThanOrEqual(2);
  });

  it('claims pending alerts with lease and skips locked ones', async () => {
    const now = new Date();
    const claimed = await repository.claimPending(1, now, 60_000, 'worker-1');
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.status).toBe('processing');
    expect(claimed[0]!.attemptCount).toBe(1);
    expect(claimed[0]!.lockedBy).toBe('worker-1');

    // Second claim at same time cannot claim the locked alert
    const claimed2 = await repository.claimPending(1, now, 60_000, 'worker-2');
    expect(claimed2).toHaveLength(1);
    expect(claimed2[0]!.id).not.toBe(claimed[0]!.id);

    // No more pending
    const emptyClaim = await repository.claimPending(5, now, 60_000, 'worker-1');
    expect(emptyClaim.some((a) => a.id === claimed[0]!.id)).toBe(false);
  });

  it('marks alert sent and releases lock', async () => {
    const now = new Date();
    const [alert] = await repository.enqueue({
      submissionId: testSubId,
      chatId: '10003',
      message: 'Alerta a enviar',
    });
    expect(alert).toBeDefined();

    const [claimed] = await repository.claimPending(1, now, 60_000);
    expect(claimed).toBeDefined();
    expect(claimed!.id).toBe(alert!.id);

    await repository.markSent(claimed!.id, 'tg_msg_999', now);

    const fetched = await repository.findById(claimed!.id);
    expect(fetched?.status).toBe('sent');
    expect(fetched?.providerMessageId).toBe('tg_msg_999');
    expect(fetched?.lockedUntil).toBeNull();
  });

  it('marks retryable failure with future availableAt', async () => {
    const now = new Date();
    const [alert] = await repository.enqueue({
      submissionId: testSubId,
      chatId: '10004',
      message: 'Alerta a fallar',
    });
    expect(alert).toBeDefined();

    const [claimed] = await repository.claimPending(1, now, 60_000);
    expect(claimed).toBeDefined();
    expect(claimed!.id).toBe(alert!.id);

    const retryAt = new Date(now.getTime() + 30_000);
    await repository.markRetryableFailure(claimed!.id, 'Rate limit 429', retryAt, now);

    const fetched = await repository.findById(claimed!.id);
    expect(fetched?.status).toBe('pending');
    expect(fetched?.lastError).toBe('Rate limit 429');
    expect(fetched?.lockedUntil).toBeNull();

    // Not claimable before retryAt
    const immediateClaim = await repository.claimPending(10, now);
    expect(immediateClaim.some((a) => a.id === claimed!.id)).toBe(false);

    // Claimable after retryAt
    const futureClaim = await repository.claimPending(10, new Date(retryAt.getTime() + 1000));
    expect(futureClaim.some((a) => a.id === claimed!.id)).toBe(true);
  });

  it('marks permanent failure', async () => {
    const now = new Date();
    await repository.enqueue({
      submissionId: testSubId,
      chatId: '10005',
      message: 'Alerta permanente',
    });

    const [claimed] = await repository.claimPending(1, now, 60_000);
    expect(claimed).toBeDefined();
    await repository.markPermanentFailure(claimed!.id, 'Chat no encontrado', now);

    const fetched = await repository.findById(claimed!.id);
    expect(fetched?.status).toBe('failed');
    expect(fetched?.lastError).toBe('Chat no encontrado');
    expect(fetched?.lockedUntil).toBeNull();
  });
});
