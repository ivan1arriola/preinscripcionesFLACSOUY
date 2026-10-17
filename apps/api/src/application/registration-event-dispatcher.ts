import crypto from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema, RegistrationEventOutboxTable } from '../infrastructure/database/schema.js';
import { signFlacsoWebhook } from './registration-event.js';

type OutboxRow = Selectable<RegistrationEventOutboxTable>;
export interface RegistrationEventFetch {
  (url: string, init: RequestInit): Promise<Response>;
}

export class RegistrationEventDispatcher {
  private readonly workerId: string;

  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly options: {
      endpoint?: string;
      secret?: string;
      fetch?: RegistrationEventFetch;
      timeoutMs?: number;
      workerId?: string;
    } = {}
  ) {
    this.workerId = options.workerId ?? `registration-outbox-${crypto.randomUUID()}`;
  }

  async runBatch(limit = 20, now = new Date()): Promise<{ status: string; processed: number }> {
    if (!this.options.endpoint || !this.options.secret) return { status: 'not_configured', processed: 0 };
    const rows = await this.claim(limit, now);
    let processed = 0;
    for (const row of rows) {
      await this.deliver(row);
      processed++;
    }
    return { status: 'completed', processed };
  }

  private async claim(limit: number, now: Date): Promise<OutboxRow[]> {
    const workerId = this.workerId;
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx.selectFrom('registration_event_outbox').selectAll()
        .where((eb) => eb.and([
          eb.or([
            eb('status', '=', 'pending'),
            eb.and([eb('status', '=', 'processing'), eb('locked_until', '<', now)]),
          ]),
          eb('available_at', '<=', now),
        ]))
        .orderBy('available_at', 'asc').orderBy('created_at', 'asc')
        .limit(Math.max(1, Math.min(limit, 100))).forUpdate().skipLocked().execute();
      if (rows.length === 0) return [];
      await trx.updateTable('registration_event_outbox').set((eb) => ({
        status: 'processing',
        locked_until: new Date(now.getTime() + 60_000),
        locked_by: workerId,
        attempt_count: eb('attempt_count', '+', 1),
        updated_at: now,
      })).where('id', 'in', rows.map((row) => row.id)).execute();
      return rows.map((row) => ({ ...row, attempt_count: row.attempt_count + 1, locked_by: workerId }));
    });
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const body = row.payload_json;
    const signed = signFlacsoWebhook(body, this.options.secret!);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    try {
      const response = await (this.options.fetch ?? fetch)(this.options.endpoint!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': row.idempotency_key,
          'x-flacso-timestamp': signed.timestamp,
          'x-flacso-signature': signed.signature,
        },
        body,
        signal: controller.signal,
      });
      if (response.ok) {
        await this.db.updateTable('registration_event_outbox').set({
          status: 'delivered', payload_json: '{}', delivered_at: new Date(), locked_until: null, locked_by: null,
          last_error: null, updated_at: new Date(),
        }).where('id', '=', row.id).where('locked_by', '=', row.locked_by ?? '').execute();
        return;
      }
      const retryable = response.status === 429 || response.status >= 500;
      await this.recordFailure(row, `upstream_http_${response.status}`, retryable);
    } catch (error) {
      await this.recordFailure(row, error instanceof Error && error.name === 'AbortError' ? 'upstream_timeout' : 'upstream_transport', true);
    } finally {
      clearTimeout(timer);
    }
  }

  private async recordFailure(row: OutboxRow, safeCode: string, retryable: boolean): Promise<void> {
    const exhausted = row.attempt_count >= 20;
    const status = retryable && !exhausted ? 'pending' : 'failed';
    const delaySeconds = Math.min(3600, 5 * 2 ** Math.min(row.attempt_count - 1, 10));
    await this.db.updateTable('registration_event_outbox').set({
      status,
      available_at: new Date(Date.now() + delaySeconds * 1000),
      locked_until: null,
      locked_by: null,
      last_error: safeCode,
      updated_at: new Date(),
    }).where('id', '=', row.id).where('locked_by', '=', row.locked_by ?? '').execute();
  }

  start(intervalMs = 5_000): () => void {
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      try {
        const result = await this.runBatch();
        if (result.processed) console.info(`[RegistrationOutbox] entregados=${result.processed}`);
      } catch (error) {
        console.error('[RegistrationOutbox] no se pudo procesar el lote:', error instanceof Error ? error.message : 'error');
      }
      if (!stopped) timer = setTimeout(run, intervalMs);
    };
    let timer = setTimeout(run, intervalMs);
    return () => { stopped = true; clearTimeout(timer); };
  }
}
