import crypto from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema, MauticEnrollmentNotifyTable } from '../infrastructure/database/schema.js';
import { signMauticEnrollment, type MauticEnrollmentNotice } from '../domain/mautic-enrollment.js';
import { syncBackoffSeconds } from './mautic-contact-sync-dispatcher.js';

type NotifyRow = Selectable<MauticEnrollmentNotifyTable>;

export const MAX_NOTIFY_ATTEMPTS = 20;
const REQUEST_TIMEOUT_MS = 15_000;

export interface EnrollmentWebhook {
  url: string;
  secret: string;
}

/** Envía el POST y devuelve el status HTTP. Lanza ante un fallo de red. */
export type EnrollmentSender = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<number>;

export type NotifyOutcome =
  | { status: 'notified' }
  | { status: 'retry'; safeCode: string }
  | { status: 'failed'; safeCode: string };

export const fetchEnrollmentSender: EnrollmentSender = async (url, init) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return response.status;
};

/**
 * Envía un aviso firmado y clasifica el resultado. No registra datos personales.
 *
 * Mautic es idempotente por eventId, así que reintentar es seguro. Sólo un 422
 * (datos rechazados) es definitivo: 401 (firma o reloj), 503 (secreto sin
 * configurar en Mautic), 5xx y fallos de red se reintentan.
 */
export async function notifyEnrollment(
  eventId: string,
  payloadJson: string,
  webhook: EnrollmentWebhook,
  send: EnrollmentSender,
  attemptCount: number,
  now: number = Date.now(),
): Promise<NotifyOutcome> {
  let notice: MauticEnrollmentNotice;
  try {
    notice = JSON.parse(payloadJson) as MauticEnrollmentNotice;
  } catch {
    return { status: 'failed', safeCode: 'invalid_payload' };
  }
  if (!notice?.email || !Number.isInteger(notice.offerWpId)) {
    return { status: 'failed', safeCode: 'invalid_payload' };
  }

  const body = JSON.stringify({ eventId, email: notice.email, offerWpId: notice.offerWpId });
  const timestamp = String(Math.floor(now / 1000));
  let httpStatus: number;
  try {
    httpStatus = await send(webhook.url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Flacso-Timestamp': timestamp,
        'X-Flacso-Signature': signMauticEnrollment(webhook.secret, timestamp, body),
      },
      body,
    });
  } catch {
    return attemptCount >= MAX_NOTIFY_ATTEMPTS
      ? { status: 'failed', safeCode: 'mautic_unavailable' }
      : { status: 'retry', safeCode: 'mautic_unavailable' };
  }

  if (httpStatus >= 200 && httpStatus < 300) return { status: 'notified' };
  const safeCode = `mautic_http_${httpStatus}`;
  if (httpStatus === 422 || attemptCount >= MAX_NOTIFY_ATTEMPTS) return { status: 'failed', safeCode };
  return { status: 'retry', safeCode };
}

/**
 * Procesa el outbox mautic_enrollment_notify: reclama filas con SKIP LOCKED,
 * envía el aviso firmado y, al confirmar, vacía el payload.
 */
export class MauticEnrollmentNotifyDispatcher {
  private readonly workerId: string;

  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly options: {
      /** null mientras falte la URL de Mautic o el secreto: las filas quedan pendientes. */
      getWebhook: () => Promise<EnrollmentWebhook | null>;
      send?: EnrollmentSender;
      workerId?: string;
      onPermanentFailure?: (failure: { submissionId: string; safeCode: string }) => Promise<void>;
    },
  ) {
    this.workerId = options.workerId ?? `mautic-enrollments-${crypto.randomUUID()}`;
  }

  async runBatch(limit = 20, now = new Date()): Promise<{ status: string; processed: number }> {
    const webhook = await this.options.getWebhook();
    if (!webhook) return { status: 'not_configured', processed: 0 };
    const send = this.options.send ?? fetchEnrollmentSender;
    const rows = await this.claim(limit, now);
    for (const row of rows) {
      await this.record(row, await notifyEnrollment(row.id, row.payload_json, webhook, send, row.attempt_count));
    }
    return { status: 'completed', processed: rows.length };
  }

  private async claim(limit: number, now: Date): Promise<NotifyRow[]> {
    const workerId = this.workerId;
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx.selectFrom('mautic_enrollment_notify').selectAll()
        .where((eb) => eb.and([
          eb.or([
            eb('status', '=', 'pending'),
            eb.and([eb('status', '=', 'processing'), eb('locked_until', '<', now)]),
          ]),
          eb('available_at', '<=', now),
        ]))
        .orderBy('available_at', 'asc')
        .limit(Math.max(1, Math.min(limit, 100))).forUpdate().skipLocked().execute();
      if (rows.length === 0) return [];
      await trx.updateTable('mautic_enrollment_notify').set((eb) => ({
        status: 'processing',
        locked_until: new Date(now.getTime() + 60_000),
        locked_by: workerId,
        attempt_count: eb('attempt_count', '+', 1),
        updated_at: now,
      })).where('id', 'in', rows.map((row) => row.id)).execute();
      return rows.map((row) => ({ ...row, attempt_count: row.attempt_count + 1, locked_by: workerId }));
    });
  }

  private async record(row: NotifyRow, outcome: NotifyOutcome): Promise<void> {
    const base = this.db.updateTable('mautic_enrollment_notify');
    const now = new Date();
    if (outcome.status === 'notified') {
      await base.set({
        status: 'notified', payload_json: '{}', notified_at: now,
        locked_until: null, locked_by: null, last_error: null, updated_at: now,
      }).where('id', '=', row.id).where('locked_by', '=', row.locked_by ?? '').execute();
      return;
    }

    await base.set({
      status: outcome.status === 'failed' ? 'failed' : 'pending',
      available_at: new Date(now.getTime() + syncBackoffSeconds(row.attempt_count) * 1000),
      locked_until: null, locked_by: null, last_error: outcome.safeCode, updated_at: now,
    }).where('id', '=', row.id).where('locked_by', '=', row.locked_by ?? '').execute();

    if (outcome.status === 'failed' && this.options.onPermanentFailure) {
      try {
        await this.options.onPermanentFailure({ submissionId: row.submission_id, safeCode: outcome.safeCode });
      } catch (error) {
        console.error('[MauticEnrollments] no se pudo avisar el fallo definitivo:', error instanceof Error ? error.message : 'error');
      }
    }
  }

  start(intervalMs = 10_000): () => void {
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      try {
        const result = await this.runBatch();
        if (result.processed) console.info(`[MauticEnrollments] procesados=${result.processed}`);
      } catch (error) {
        console.error('[MauticEnrollments] no se pudo procesar el lote:', error instanceof Error ? error.message : 'error');
      }
      if (!stopped) timer = setTimeout(run, intervalMs);
    };
    let timer = setTimeout(run, intervalMs);
    return () => { stopped = true; clearTimeout(timer); };
  }
}
