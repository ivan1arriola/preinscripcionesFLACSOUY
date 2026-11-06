import type { KyselyDb } from './kysely.js';
import type {
  SheetsAttemptRecord,
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
    };
  }

  async recordAttemptStarted(submissionId: string, startedAt: Date): Promise<void> {
    await this.db
      .updateTable('submission_processing')
      .set({
        sheet_attempt_started_at: startedAt,
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
        updated_at: writtenAt,
      })
      .where('submission_id', '=', submissionId)
      .execute();
  }
}
