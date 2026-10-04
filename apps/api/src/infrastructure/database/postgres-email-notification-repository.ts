import crypto from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema, EmailNotificationsTable } from './schema.js';
import type {
  EmailNotificationRepository,
  EmailNotificationRecord,
  EnsureEmailNotificationsInput,
  EmailNotificationFilter,
  EmailNotificationCounts,
} from '../../ports/email-notification-repository.js';

function mapRow(row: Selectable<EmailNotificationsTable>): EmailNotificationRecord {
  return {
    id: row.id,
    submissionId: row.submission_id,
    audience: row.audience,
    recipientEmail: row.recipient_email,
    targetId: row.target_id,
    templateVersion: row.template_version,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    attemptCount: row.attempt_count,
    providerMessageId: row.provider_message_id ?? undefined,
    lastError: row.last_error ?? undefined,
    availableAt: new Date(row.available_at),
    lockedUntil: row.locked_until ? new Date(row.locked_until) : undefined,
    sentAt: row.sent_at ? new Date(row.sent_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class PostgresEmailNotificationRepository implements EmailNotificationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async ensureForSubmission(input: EnsureEmailNotificationsInput): Promise<EmailNotificationRecord[]> {
    const now = input.availableAt ?? new Date();
    const payloadJson = JSON.stringify(input.snapshot);

    for (const recipient of input.recipients) {
      const normalizedEmail = recipient.email.trim().toLowerCase();
      if (!normalizedEmail) continue;

      const id = `notif_${crypto.randomUUID()}`;

      await this.db
        .insertInto('email_notifications')
        .values({
          id,
          submission_id: input.submissionId,
          audience: recipient.audience,
          recipient_email: normalizedEmail,
          target_id: input.snapshot.targetId,
          template_version: input.snapshot.templateVersion,
          payload_json: payloadJson,
          status: 'pending',
          attempt_count: 0,
          available_at: now,
          locked_until: null,
          sent_at: null,
          created_at: now as any,
          updated_at: now as any,
        })
        .onConflict((oc) =>
          oc.columns(['submission_id', 'audience', 'recipient_email', 'template_version']).doNothing()
        )
        .execute();
    }

    const rows = await this.db
      .selectFrom('email_notifications')
      .selectAll()
      .where('submission_id', '=', input.submissionId)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(mapRow);
  }

  async claimPending(limit: number, now: Date, leaseDurationMs = 300_000): Promise<EmailNotificationRecord[]> {
    return await this.db.transaction().execute(async (trx) => {
      const lockedUntil = new Date(now.getTime() + leaseDurationMs);

      const candidates = await trx
        .selectFrom('email_notifications')
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
        .updateTable('email_notifications')
        .set((eb) => ({
          status: 'processing',
          locked_until: lockedUntil,
          attempt_count: eb('attempt_count', '+', 1),
          updated_at: now,
        }))
        .where('id', 'in', ids)
        .execute();

      const updatedRows = await trx
        .selectFrom('email_notifications')
        .selectAll()
        .where('id', 'in', ids)
        .execute();

      return updatedRows.map(mapRow);
    });
  }

  async markSent(id: string, providerMessageId: string, now: Date): Promise<void> {
    await this.db
      .updateTable('email_notifications')
      .set({
        status: 'sent',
        provider_message_id: providerMessageId,
        sent_at: now,
        locked_until: null,
        last_error: null,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
  }

  async markRetryableFailure(id: string, error: string, availableAt: Date): Promise<void> {
    await this.db
      .updateTable('email_notifications')
      .set({
        status: 'pending',
        last_error: error,
        available_at: availableAt,
        locked_until: null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async markPermanentFailure(id: string, error: string, now: Date): Promise<void> {
    await this.db
      .updateTable('email_notifications')
      .set({
        status: 'failed',
        last_error: error,
        locked_until: null,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
  }

  async markUnknown(id: string, error: string): Promise<void> {
    await this.db
      .updateTable('email_notifications')
      .set({
        status: 'unknown',
        last_error: error,
        locked_until: null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async listMissingForSuccessfulSubmissions(limit: number): Promise<string[]> {
    const rows = await this.db
      .selectFrom('submissions')
      .innerJoin('submission_processing', 'submission_processing.submission_id', 'submissions.id')
      .select('submissions.id')
      .where('submission_processing.status', '=', 'success')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('email_notifications')
              .select('email_notifications.id')
              .whereRef('email_notifications.submission_id', '=', 'submissions.id')
          )
        )
      )
      .orderBy('submissions.submitted_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map((r) => r.id);
  }

  async listNotifications(filter?: EmailNotificationFilter): Promise<EmailNotificationRecord[]> {
    let query = this.db.selectFrom('email_notifications').selectAll();

    if (filter?.status) {
      query = query.where('status', '=', filter.status);
    }
    if (filter?.submissionId) {
      query = query.where('submission_id', '=', filter.submissionId);
    }

    query = query.orderBy('created_at', 'desc');

    if (filter?.offset) {
      query = query.offset(filter.offset);
    }
    if (filter?.limit) {
      query = query.limit(filter.limit);
    }

    const rows = await query.execute();
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<EmailNotificationRecord | null> {
    const row = await this.db
      .selectFrom('email_notifications')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async resetForManualRetry(id: string, now: Date, updatedEmail?: string): Promise<void> {
    const updateValues: Record<string, unknown> = {
      status: 'pending',
      available_at: now,
      locked_until: null,
      updated_at: now,
    };
    if (updatedEmail) {
      updateValues.recipient_email = updatedEmail;
    }

    await this.db
      .updateTable('email_notifications')
      .set(updateValues)
      .where('id', '=', id)
      .where('status', 'in', ['failed', 'unknown'])
      .execute();
  }

  async getCounts(): Promise<EmailNotificationCounts> {
    const rows = await this.db
      .selectFrom('email_notifications')
      .select(['status', (eb) => eb.fn.count('id').as('count')])
      .groupBy('status')
      .execute();

    const counts = { pending: 0, processing: 0, sent: 0, failed: 0, unknown: 0, total: 0 };
    for (const row of rows) {
      const s = row.status as keyof typeof counts;
      const c = Number(row.count);
      if (s in counts) {
        counts[s] = c;
        counts.total += c;
      }
    }
    return counts;
  }
}
