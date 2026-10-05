import crypto from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema, TelegramRecoveryAlertsTable } from './schema.js';
import type {
  TelegramAlertRepository,
  TelegramAlertRecord,
  EnqueueTelegramAlertInput,
  TelegramAlertCounts,
  TelegramAlertFilter,
} from '../../ports/telegram-alert-repository.js';

function mapRow(row: Selectable<TelegramRecoveryAlertsTable>): TelegramAlertRecord {
  return {
    id: row.id,
    recoveryId: row.recovery_id,
    submissionId: row.submission_id,
    chatId: row.chat_id,
    message: row.message,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: new Date(row.available_at),
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
    lockedBy: row.locked_by,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class PostgresTelegramAlertRepository implements TelegramAlertRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async enqueue(
    input: EnqueueTelegramAlertInput | EnqueueTelegramAlertInput[]
  ): Promise<TelegramAlertRecord[]> {
    const items = Array.isArray(input) ? input : [input];
    if (items.length === 0) return [];

    const now = new Date();
    const createdIds: string[] = [];

    await this.db.transaction().execute(async (trx) => {
      for (const item of items) {
        const id = `tga_${crypto.randomUUID().replace(/-/g, '')}`;
        createdIds.push(id);
        await trx
          .insertInto('telegram_recovery_alerts')
          .values({
            id,
            recovery_id: item.recoveryId ?? null,
            submission_id: item.submissionId,
            chat_id: item.chatId,
            message: item.message,
            status: 'pending',
            attempt_count: 0,
            max_attempts: item.maxAttempts ?? 5,
            available_at: item.availableAt ?? now,
            locked_until: null,
            locked_by: null,
            provider_message_id: null,
            last_error: null,
            sent_at: null,
            created_at: now,
            updated_at: now,
          })
          .execute();
      }
    });

    const rows = await this.db
      .selectFrom('telegram_recovery_alerts')
      .selectAll()
      .where('id', 'in', createdIds)
      .execute();

    return rows.map(mapRow);
  }

  async claimPending(
    limit: number,
    now: Date,
    leaseDurationMs = 60_000,
    lockedBy?: string
  ): Promise<TelegramAlertRecord[]> {
    return await this.db.transaction().execute(async (trx) => {
      const lockedUntil = new Date(now.getTime() + leaseDurationMs);

      const candidates = await trx
        .selectFrom('telegram_recovery_alerts')
        .selectAll()
        .where((eb) =>
          eb.and([
            eb.or([
              eb('status', '=', 'pending'),
              eb.and([
                eb('status', '=', 'processing'),
                eb('locked_until', 'is not', null),
                eb('locked_until', '<', now),
              ]),
            ]),
            eb('available_at', '<=', now),
            eb.or([
              eb('locked_until', 'is', null),
              eb('locked_until', '<', now),
            ]),
          ])
        )
        .orderBy('available_at', 'asc')
        .orderBy('created_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();

      if (candidates.length === 0) {
        return [];
      }

      const ids = candidates.map((c) => c.id);

      await trx
        .updateTable('telegram_recovery_alerts')
        .set((eb) => ({
          status: 'processing',
          locked_until: lockedUntil,
          locked_by: lockedBy ?? null,
          attempt_count: eb('attempt_count', '+', 1),
          updated_at: now,
        }))
        .where('id', 'in', ids)
        .execute();

      const updatedRows = await trx
        .selectFrom('telegram_recovery_alerts')
        .selectAll()
        .where('id', 'in', ids)
        .orderBy('available_at', 'asc')
        .orderBy('created_at', 'asc')
        .execute();

      return updatedRows.map(mapRow);
    });
  }

  async markSent(id: string, providerMessageId?: string, now = new Date()): Promise<void> {
    await this.db
      .updateTable('telegram_recovery_alerts')
      .set({
        status: 'sent',
        provider_message_id: providerMessageId ?? null,
        sent_at: now,
        locked_until: null,
        locked_by: null,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
  }

  async markRetryableFailure(
    id: string,
    error: string,
    availableAt: Date,
    now = new Date()
  ): Promise<void> {
    await this.db
      .updateTable('telegram_recovery_alerts')
      .set({
        status: 'pending',
        last_error: error,
        available_at: availableAt,
        locked_until: null,
        locked_by: null,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
  }

  async markPermanentFailure(id: string, error: string, now = new Date()): Promise<void> {
    await this.db
      .updateTable('telegram_recovery_alerts')
      .set({
        status: 'failed',
        last_error: error,
        locked_until: null,
        locked_by: null,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
  }

  async getCounts(): Promise<TelegramAlertCounts> {
    const rows = await this.db
      .selectFrom('telegram_recovery_alerts')
      .select(['status', (eb) => eb.fn.count<string>('id').as('count')])
      .groupBy('status')
      .execute();

    const counts: TelegramAlertCounts = {
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      total: 0,
    };

    for (const r of rows) {
      const c = Number(r.count);
      counts.total += c;
      if (r.status === 'pending') counts.pending = c;
      else if (r.status === 'processing') counts.processing = c;
      else if (r.status === 'sent') counts.sent = c;
      else if (r.status === 'failed') counts.failed = c;
    }

    return counts;
  }

  async listAlerts(filter?: TelegramAlertFilter): Promise<TelegramAlertRecord[]> {
    let query = this.db.selectFrom('telegram_recovery_alerts').selectAll();

    if (filter?.status) {
      query = query.where('status', '=', filter.status);
    }
    if (filter?.submissionId) {
      query = query.where('submission_id', '=', filter.submissionId);
    }

    query = query.orderBy('created_at', 'desc');

    if (filter?.limit) {
      query = query.limit(filter.limit);
    }
    if (filter?.offset) {
      query = query.offset(filter.offset);
    }

    const rows = await query.execute();
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<TelegramAlertRecord | null> {
    const row = await this.db
      .selectFrom('telegram_recovery_alerts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }
}
