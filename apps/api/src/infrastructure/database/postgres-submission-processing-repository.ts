import { sql } from 'kysely';
import type { KyselyDb } from './kysely.js';
import {
  MAX_TASK_ATTEMPTS,
  type AbandonedSubmission,
  type SubmissionProcessingRepository,
  type SubmissionTask,
  type SubmissionTaskKind,
} from '../../ports/submission-processing-repository.js';

/** Gracia para filas sin lease (anteriores al protocolo): no marcar como abandonado un envío que aún arranca. */
const LEGACY_GRACE = sql`interval '3 minutes'`;

export class PostgresSubmissionProcessingRepository implements SubmissionProcessingRepository {
  constructor(private readonly db: KyselyDb) {}

  async renewLease(submissionId: string, owner: string, now: Date, ttlMs: number): Promise<boolean> {
    const result = await this.db
      .updateTable('submission_processing')
      .set({ lease_expires_at: new Date(now.getTime() + ttlMs) })
      .where('submission_id', '=', submissionId)
      .where('lease_owner', '=', owner)
      .returning('submission_id')
      .executeTakeFirst();
    return result !== undefined;
  }

  async releaseLease(submissionId: string, owner: string): Promise<boolean> {
    const result = await this.db
      .updateTable('submission_processing')
      .set({ lease_owner: null, lease_expires_at: null })
      .where('submission_id', '=', submissionId)
      .where('lease_owner', '=', owner)
      .returning('submission_id')
      .executeTakeFirst();
    return result !== undefined;
  }

  async claimAbandoned(owner: string, now: Date, limit: number, leaseTtlMs: number): Promise<AbandonedSubmission[]> {
    const expires = new Date(now.getTime() + leaseTtlMs);
    const result = await sql<{ submission_id: string; target_id: string; legacy: boolean }>`
      WITH claimed AS (
        UPDATE submission_processing sp
           SET lease_owner = ${owner}, lease_expires_at = ${expires}
         WHERE sp.submission_id IN (
           SELECT p.submission_id FROM submission_processing p
            WHERE p.status = 'pending'
              AND COALESCE(p.lease_expires_at, p.updated_at + ${LEGACY_GRACE}) < ${now}
              AND (p.next_attempt_at IS NULL OR p.next_attempt_at <= ${now})
              AND NOT EXISTS (
                SELECT 1 FROM submission_recoveries r
                 WHERE r.submission_id = p.submission_id AND r.status IN ('pending', 'retrying'))
            ORDER BY p.updated_at
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED)
        RETURNING sp.submission_id, (sp.protocol_version IS NULL) AS legacy)
      SELECT c.submission_id, s.target_id, c.legacy
        FROM claimed c JOIN submissions s ON s.id = c.submission_id`.execute(this.db);
    return result.rows.map((row) => ({ submissionId: row.submission_id, targetId: row.target_id, legacy: row.legacy }));
  }

  async enqueueTask(task: { submissionId: string; kind: SubmissionTaskKind; runAt: Date }): Promise<void> {
    await this.db
      .insertInto('submission_tasks')
      .values({ submission_id: task.submissionId, kind: task.kind, run_at: task.runAt, claimed_by: null, claimed_until: null, done_at: null, last_error: null })
      .onConflict((oc) => oc.columns(['submission_id', 'kind', 'run_at']).doNothing())
      .execute();
  }

  async claimDueTasks(owner: string, now: Date, limit: number, claimTtlMs: number): Promise<SubmissionTask[]> {
    const until = new Date(now.getTime() + claimTtlMs);
    const result = await sql<{ id: string; submission_id: string; kind: SubmissionTaskKind; run_at: Date; attempts: number }>`
      UPDATE submission_tasks
         SET claimed_by = ${owner}, claimed_until = ${until}, attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM submission_tasks
          WHERE done_at IS NULL AND run_at <= ${now} AND (claimed_until IS NULL OR claimed_until < ${now})
          ORDER BY run_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, submission_id, kind, run_at, attempts`.execute(this.db);
    return result.rows.map((row) => ({
      id: String(row.id), submissionId: row.submission_id, kind: row.kind, runAt: row.run_at, attempts: row.attempts,
    }));
  }

  async completeTask(taskId: string, owner: string): Promise<boolean> {
    const result = await sql`
      UPDATE submission_tasks SET done_at = ${new Date()}, claimed_until = NULL
       WHERE id = ${taskId} AND claimed_by = ${owner} AND done_at IS NULL
      RETURNING id`.execute(this.db);
    return result.rows.length > 0;
  }

  async failTask(taskId: string, owner: string, error: string, now: Date): Promise<'rescheduled' | 'gave_up'> {
    const current = await this.db
      .selectFrom('submission_tasks')
      .select('attempts')
      .where('id', '=', taskId)
      .where('claimed_by', '=', owner)
      .where('done_at', 'is', null)
      .executeTakeFirst();
    if (!current) return 'gave_up';
    const attempts = Number(current.attempts);
    if (attempts >= MAX_TASK_ATTEMPTS) {
      await this.db
        .updateTable('submission_tasks')
        .set({ done_at: now, claimed_until: null, last_error: error })
        .where('id', '=', taskId)
        .where('claimed_by', '=', owner)
        .execute();
      return 'gave_up';
    }
    // Retroceso exponencial con tope de una hora: 2, 4, 8, 16 min.
    const delayMs = Math.min(2 ** attempts * 60_000, 60 * 60_000);
    await this.db
      .updateTable('submission_tasks')
      .set({ run_at: new Date(now.getTime() + delayMs), claimed_by: null, claimed_until: null, last_error: error })
      .where('id', '=', taskId)
      .where('claimed_by', '=', owner)
      .execute();
    return 'rescheduled';
  }
}
