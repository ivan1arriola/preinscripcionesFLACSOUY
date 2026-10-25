import crypto from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema, MauticContactSyncTable } from '../infrastructure/database/schema.js';
import type { MauticContactSync } from '../domain/mautic-contact.js';
import { MauticError, type MauticClient } from '../infrastructure/mautic/mautic-client.js';

type SyncRow = Selectable<MauticContactSyncTable>;
export type MauticContactUpserter = Pick<MauticClient, 'upsertContact'>;

export const MAX_SYNC_ATTEMPTS = 20;

export type SyncOutcome =
  | { status: 'synced'; contactId: number }
  | { status: 'retry'; safeCode: string }
  | { status: 'failed'; safeCode: string };

/** Sincroniza un contacto y clasifica el resultado. No registra datos personales. */
export async function syncContact(
  payloadJson: string,
  client: MauticContactUpserter,
  attemptCount: number,
): Promise<SyncOutcome> {
  let payload: MauticContactSync;
  try {
    payload = JSON.parse(payloadJson) as MauticContactSync;
  } catch {
    return { status: 'failed', safeCode: 'invalid_payload' };
  }
  try {
    return { status: 'synced', contactId: await client.upsertContact(payload.email, payload.fields, payload.tags) };
  } catch (error) {
    const httpStatus = error instanceof MauticError ? error.httpStatus : undefined;
    const safeCode = httpStatus ? `mautic_http_${httpStatus}` : 'mautic_unavailable';
    // Un upsert repetido es seguro: sólo los rechazos de datos (4xx salvo 401/403/429) son definitivos.
    const permanent = error instanceof MauticError
      && error.classification === 'permanent'
      && httpStatus !== undefined && ![401, 403, 429].includes(httpStatus);
    if (permanent || attemptCount >= MAX_SYNC_ATTEMPTS) return { status: 'failed', safeCode };
    return { status: 'retry', safeCode };
  }
}

export function syncBackoffSeconds(attemptCount: number): number {
  return Math.min(3600, 5 * 2 ** Math.min(Math.max(attemptCount, 1) - 1, 10));
}

/**
 * Procesa el outbox mautic_contact_sync: reclama filas con SKIP LOCKED, hace el
 * upsert y, al confirmar, vacía el payload y guarda el ID del contacto.
 */
export class MauticContactSyncDispatcher {
  private readonly workerId: string;

  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly options: {
      /** null cuando Mautic no está configurado: las filas quedan pendientes. */
      getClient: () => Promise<MauticContactUpserter | null>;
      workerId?: string;
      onPermanentFailure?: (failure: { submissionId: string; safeCode: string }) => Promise<void>;
    },
  ) {
    this.workerId = options.workerId ?? `mautic-contacts-${crypto.randomUUID()}`;
  }

  async runBatch(limit = 20, now = new Date()): Promise<{ status: string; processed: number }> {
    const client = await this.options.getClient();
    if (!client) return { status: 'not_configured', processed: 0 };
    const rows = await this.claim(limit, now);
    for (const row of rows) {
      await this.record(row, await syncContact(row.payload_json, client, row.attempt_count));
    }
    return { status: 'completed', processed: rows.length };
  }

  private async claim(limit: number, now: Date): Promise<SyncRow[]> {
    const workerId = this.workerId;
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx.selectFrom('mautic_contact_sync').selectAll()
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
      await trx.updateTable('mautic_contact_sync').set((eb) => ({
        status: 'processing',
        locked_until: new Date(now.getTime() + 60_000),
        locked_by: workerId,
        attempt_count: eb('attempt_count', '+', 1),
        updated_at: now,
      })).where('id', 'in', rows.map((row) => row.id)).execute();
      return rows.map((row) => ({ ...row, attempt_count: row.attempt_count + 1, locked_by: workerId }));
    });
  }

  private async record(row: SyncRow, outcome: SyncOutcome): Promise<void> {
    const base = this.db.updateTable('mautic_contact_sync');
    const now = new Date();
    if (outcome.status === 'synced') {
      await base.set({
        status: 'synced', payload_json: '{}', mautic_contact_id: outcome.contactId, synced_at: now,
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
        console.error('[MauticContacts] no se pudo avisar el fallo definitivo:', error instanceof Error ? error.message : 'error');
      }
    }
  }

  start(intervalMs = 10_000): () => void {
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      try {
        const result = await this.runBatch();
        if (result.processed) console.info(`[MauticContacts] procesados=${result.processed}`);
      } catch (error) {
        console.error('[MauticContacts] no se pudo procesar el lote:', error instanceof Error ? error.message : 'error');
      }
      if (!stopped) timer = setTimeout(run, intervalMs);
    };
    let timer = setTimeout(run, intervalMs);
    return () => { stopped = true; clearTimeout(timer); };
  }
}
