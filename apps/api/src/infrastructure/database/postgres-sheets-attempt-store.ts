import type { KyselyDb } from './kysely.js';
import { sql } from 'kysely';
import type {
  SheetsAttemptRecord,
  SheetsContext,
  SheetsPayload,
  SheetsAttemptStore,
} from '../../ports/sheets-attempt-store.js';

export class PostgresSheetsAttemptStore implements SheetsAttemptStore {
  constructor(private readonly db: KyselyDb) {}

  async get(submissionId: string): Promise<SheetsAttemptRecord | null> {
    const row = await this.db
      .selectFrom('submission_processing')
      .select([
        'submission_id',
        'status',
        'sheet_attempt_started_at',
        'sheet_written_at',
        'next_attempt_at',
        'sheet_payload',
      ])
      .where('submission_id', '=', submissionId)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return {
      submissionId: row.submission_id,
      status: row.status,
      sheetAttemptStartedAt: row.sheet_attempt_started_at ? new Date(row.sheet_attempt_started_at) : null,
      sheetWrittenAt: row.sheet_written_at ? new Date(row.sheet_written_at) : null,
      nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : null,
      payload: (row.sheet_payload as SheetsPayload | null) ?? null,
    };
  }

  async loadContext(submissionId: string): Promise<SheetsContext | null> {
    const row = await this.db
      .selectFrom('submission_processing as p')
      .innerJoin('submissions as s', 's.id', 'p.submission_id')
      .select(['s.target_id', 'p.sheet_payload'])
      .where('p.submission_id', '=', submissionId)
      .executeTakeFirst();
    const payload = row?.sheet_payload as SheetsPayload | null | undefined;
    if (!row || !payload) return null;
    return { targetId: row.target_id, ...payload };
  }

  async recordAttemptStarted(submissionId: string, startedAt: Date, payload?: SheetsPayload): Promise<void> {
    await this.db
      .updateTable('submission_processing')
      .set({
        sheet_attempt_started_at: startedAt,
        ...(payload ? { sheet_payload: JSON.stringify(payload) } : {}),
        updated_at: startedAt,
      })
      .where('submission_id', '=', submissionId)
      .execute();
  }

  async markUncertain(submissionId: string, nextAttemptAt: Date, error?: string): Promise<void> {
    await this.db
      .updateTable('submission_processing')
      .set({
        status: 'sheet_uncertain',
        next_attempt_at: nextAttemptAt,
        error_message: error ?? null,
        updated_at: new Date(),
      })
      .where('submission_id', '=', submissionId)
      .execute();
  }

  async recordWritten(submissionId: string, writtenAt: Date): Promise<void> {
    await this.db
      .updateTable('submission_processing')
      .set({
        sheet_written_at: writtenAt,
        // Ya está en la planilla: no se conservan datos personales; las tareas de recuento solo usan el destino.
        sheet_payload: sql`CASE WHEN sheet_payload IS NULL THEN NULL ELSE jsonb_set(sheet_payload, '{valuesByColumnName}', '{}'::jsonb) END`,
        updated_at: writtenAt,
      })
      .where('submission_id', '=', submissionId)
      .execute();
  }
}
