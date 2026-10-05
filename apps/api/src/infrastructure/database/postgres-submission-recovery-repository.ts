import crypto from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema, SubmissionRecoveriesTable, SubmissionFilesTable } from './schema.js';
import type {
  SubmissionRecoveryRepository,
  SubmissionRecoveryRecord,
  CreateRecoveryInput,
  SubmissionRecoveryFilter,
  RetryResultInput,
} from '../../ports/submission-recovery-repository.js';

function mapRow(
  row: Selectable<SubmissionRecoveriesTable>,
  files?: Selectable<SubmissionFilesTable>[],
  values?: Record<string, string>,
  targetTitle?: string,
  targetKind?: string
): SubmissionRecoveryRecord {
  return {
    id: row.id,
    submissionId: row.submission_id,
    targetId: row.target_id,
    targetTitle,
    targetKind,
    stage: row.stage,
    status: row.status,
    safeError: row.safe_error,
    attemptCount: row.attempt_count,
    firstFailedAt: row.first_failed_at,
    lastAttemptAt: row.last_attempt_at,
    retentionExpiresAt: row.retention_expires_at,
    lockedUntil: row.locked_until,
    lockedBy: row.locked_by,
    discardedAt: row.discarded_at,
    discardedBy: row.discarded_by,
    discardReason: row.discard_reason,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: files?.map((f) => ({
      token: f.token,
      fieldKey: f.field_key,
      originalName: f.original_name,
      size: f.size,
      mimeType: f.mime_type,
      status: f.status,
      driveFileId: f.drive_file_id,
      errorMessage: f.error_message,
    })),
    values,
  };
}

export class PostgresSubmissionRecoveryRepository implements SubmissionRecoveryRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async recordFailure(input: CreateRecoveryInput): Promise<SubmissionRecoveryRecord> {
    const now = input.now ?? new Date();
    const retentionDays = input.retentionDays ?? 7;
    const retentionExpiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    const id = `rec_${crypto.randomUUID().slice(0, 12)}`;

    const row = await this.db
      .insertInto('submission_recoveries')
      .values({
        id,
        submission_id: input.submissionId,
        target_id: input.targetId,
        stage: input.stage,
        status: 'pending',
        safe_error: input.safeError,
        attempt_count: 1,
        first_failed_at: now,
        last_attempt_at: now,
        retention_expires_at: retentionExpiresAt,
        locked_until: null,
        locked_by: null,
        discarded_at: null,
        discarded_by: null,
        discard_reason: null,
        resolved_at: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column('submission_id').doUpdateSet((eb) => ({
          stage: input.stage,
          safe_error: input.safeError,
          status: 'pending',
          attempt_count: eb('submission_recoveries.attempt_count', '+', 1),
          last_attempt_at: now,
          locked_until: null,
          locked_by: null,
          updated_at: now,
        }))
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapRow(row);
  }

  async listFailed(filter?: SubmissionRecoveryFilter): Promise<SubmissionRecoveryRecord[]> {
    let query = this.db.selectFrom('submission_recoveries').selectAll();

    if (filter?.status) {
      if (Array.isArray(filter.status)) {
        query = query.where('status', 'in', filter.status);
      } else {
        query = query.where('status', '=', filter.status);
      }
    }

    if (filter?.stage) {
      query = query.where('stage', '=', filter.stage);
    }

    if (filter?.targetId) {
      query = query.where('target_id', '=', filter.targetId);
    }

    if (filter?.search) {
      const s = `%${filter.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('submission_id', 'ilike', s),
          eb('target_id', 'ilike', s),
          eb('safe_error', 'ilike', s),
        ])
      );
    }

    query = query.orderBy('last_attempt_at', 'desc');

    if (filter?.offset) {
      query = query.offset(filter.offset);
    }

    if (filter?.limit) {
      query = query.limit(filter.limit);
    }

    const rows = await query.execute();
    return rows.map((r) => mapRow(r));
  }

  async findById(idOrSubmissionId: string): Promise<SubmissionRecoveryRecord | null> {
    const row = await this.db
      .selectFrom('submission_recoveries')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('id', '=', idOrSubmissionId),
          eb('submission_id', '=', idOrSubmissionId),
        ])
      )
      .executeTakeFirst();

    if (!row) return null;

    const [files, valuesRows, targetRow] = await Promise.all([
      this.db
        .selectFrom('submission_files')
        .selectAll()
        .where('submission_id', '=', row.submission_id)
        .execute(),
      this.db
        .selectFrom('submission_values')
        .selectAll()
        .where('submission_id', '=', row.submission_id)
        .execute(),
      this.db
        .selectFrom('targets')
        .select(['title', 'kind'])
        .where('id', '=', row.target_id)
        .executeTakeFirst(),
    ]);

    const values: Record<string, string> = {};
    for (const v of valuesRows) {
      values[v.input_key] = v.value;
    }

    return mapRow(row, files, values, targetRow?.title, targetRow?.kind);
  }

  async claim(
    id: string,
    now: Date,
    leaseDurationMs: number = 60000,
    lockedBy?: string
  ): Promise<SubmissionRecoveryRecord | null> {
    const lockedUntil = new Date(now.getTime() + leaseDurationMs);

    const row = await this.db
      .updateTable('submission_recoveries')
      .set({
        locked_until: lockedUntil,
        locked_by: lockedBy ?? null,
        status: 'retrying',
        updated_at: now,
      })
      .where((eb) =>
        eb.and([
          eb.or([eb('id', '=', id), eb('submission_id', '=', id)]),
          eb('status', 'in', ['pending', 'retrying']),
          eb.or([
            eb('locked_until', 'is', null),
            eb('locked_until', '<', now),
          ]),
        ])
      )
      .returningAll()
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async release(id: string): Promise<void> {
    await this.db
      .updateTable('submission_recoveries')
      .set({
        locked_until: null,
        locked_by: null,
        status: 'pending',
        updated_at: new Date(),
      })
      .where((eb) => eb.or([eb('id', '=', id), eb('submission_id', '=', id)]))
      .execute();
  }

  async markRetryResult(id: string, result: RetryResultInput): Promise<void> {
    const now = result.now ?? new Date();

    if (result.success) {
      await this.db
        .updateTable('submission_recoveries')
        .set({
          status: 'resolved',
          resolved_at: now,
          locked_until: null,
          locked_by: null,
          updated_at: now,
        })
        .where((eb) => eb.or([eb('id', '=', id), eb('submission_id', '=', id)]))
        .execute();
    } else {
      await this.db
        .updateTable('submission_recoveries')
        .set((eb) => ({
          status: 'pending',
          stage: result.stage ?? eb.ref('stage'),
          safe_error: result.safeError ?? eb.ref('safe_error'),
          attempt_count: eb('submission_recoveries.attempt_count', '+', 1),
          last_attempt_at: now,
          locked_until: null,
          locked_by: null,
          updated_at: now,
        }))
        .where((eb) => eb.or([eb('id', '=', id), eb('submission_id', '=', id)]))
        .execute();
    }
  }

  async discard(id: string, discardedBy: string, reason?: string, now?: Date): Promise<void> {
    const ts = now ?? new Date();
    await this.db
      .updateTable('submission_recoveries')
      .set({
        status: 'discarded',
        discarded_at: ts,
        discarded_by: discardedBy,
        discard_reason: reason ?? null,
        locked_until: null,
        locked_by: null,
        updated_at: ts,
      })
      .where((eb) => eb.or([eb('id', '=', id), eb('submission_id', '=', id)]))
      .execute();
  }

  async deleteExpired(now: Date): Promise<string[]> {
    const expiredRows = await this.db
      .selectFrom('submission_recoveries')
      .select('submission_id')
      .where('retention_expires_at', '<', now)
      .execute();

    if (expiredRows.length === 0) {
      return [];
    }

    const submissionIds = expiredRows.map((r) => r.submission_id);

    await this.db
      .deleteFrom('submission_recoveries')
      .where('retention_expires_at', '<', now)
      .execute();

    return submissionIds;
  }
}
