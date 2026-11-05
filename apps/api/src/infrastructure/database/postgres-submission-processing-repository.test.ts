import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { PostgresSubmissionRepository } from './postgres-submission-repository.js';
import { PostgresSubmissionProcessingRepository } from './postgres-submission-processing-repository.js';
import { runMigrations } from './migrate.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

const min = (n: number) => n * 60_000;

integrationDescribe('PostgresSubmissionProcessingRepository (Integration with PostgreSQL)', () => {
  const db = createKyselyDb(dbUrl);
  const submissions = new PostgresSubmissionRepository(db);
  const processing = new PostgresSubmissionProcessingRepository(db);

  beforeAll(async () => {
    await runMigrations(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  async function newSubmission(clientSubmissionId = `c-${Math.random().toString(36).slice(2)}`) {
    return submissions.saveOrGet({
      clientSubmissionId, targetId: 'davia-c11', configRevision: 'v1', targetTitle: 'DAVIA', targetKind: 'academic_offer',
      values: { email: 'a@example.com' },
    } as never);
  }
  const row = (id: string) => db.selectFrom('submission_processing').selectAll().where('submission_id', '=', id).executeTakeFirstOrThrow();

  it('creates the processing row with a lease inside the acceptance transaction', async () => {
    const saved = await newSubmission();
    const r = await row(saved.id);
    expect(r.lease_owner).toBeTruthy();
    expect(r.lease_expires_at).toBeInstanceOf(Date);
    expect(r.lease_expires_at?.getTime() ?? 0).toBeGreaterThan(Date.now());
    expect(r.protocol_version).toBe(1);
    expect(saved.leaseOwner).toBe(r.lease_owner);
  });

  it('renews only for the current owner and releases only for the current owner', async () => {
    const saved = await newSubmission();
    expect(await processing.renewLease(saved.id, 'otro', new Date(), 60_000)).toBe(false);
    expect(await processing.renewLease(saved.id, saved.leaseOwner!, new Date(Date.now() + 30_000), 60_000)).toBe(true);
    expect(await processing.releaseLease(saved.id, 'otro')).toBe(false);
    expect(await processing.releaseLease(saved.id, saved.leaseOwner!)).toBe(true);
    expect((await row(saved.id)).lease_owner).toBeNull();
  });

  it('does not claim a submission whose lease is still alive', async () => {
    const saved = await newSubmission();
    const claimed = await processing.claimAbandoned('sweeper-1', new Date(), 50, 60_000);
    expect(claimed.map((c) => c.submissionId)).not.toContain(saved.id);
  });

  it('claims an abandoned submission once, even with two sweepers at the same time', async () => {
    const saved = await newSubmission();
    const later = new Date(Date.now() + min(5));
    const [a, b] = await Promise.all([
      processing.claimAbandoned('sweeper-a', later, 50, 60_000),
      processing.claimAbandoned('sweeper-b', later, 50, 60_000),
    ]);
    const hits = [...a, ...b].filter((c) => c.submissionId === saved.id);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.targetId).toBe('davia-c11');
  });

  it('selects legacy rows without a lease only after the 3 minute grace period', async () => {
    const saved = await newSubmission();
    await db.updateTable('submission_processing')
      .set({ lease_owner: null, lease_expires_at: null, protocol_version: null, updated_at: new Date() })
      .where('submission_id', '=', saved.id).execute();
    const early = await processing.claimAbandoned('s', new Date(Date.now() + min(2)), 50, 60_000);
    expect(early.map((c) => c.submissionId)).not.toContain(saved.id);
    const late = await processing.claimAbandoned('s', new Date(Date.now() + min(4)), 50, 60_000);
    const hit = late.find((c) => c.submissionId === saved.id);
    expect(hit).toBeDefined();
    expect(hit!.legacy).toBe(true);
  });

  it('skips submissions that are not pending, are waiting for next_attempt_at, or already have an active case', async () => {
    const done = await newSubmission();
    await db.updateTable('submission_processing').set({ status: 'success' }).where('submission_id', '=', done.id).execute();
    const waiting = await newSubmission();
    await db.updateTable('submission_processing').set({ next_attempt_at: new Date(Date.now() + min(60)) }).where('submission_id', '=', waiting.id).execute();
    const withCase = await newSubmission();
    await db.insertInto('submission_recoveries').values({
      id: `rec_${withCase.id}`, submission_id: withCase.id, target_id: 'davia-c11', stage: 'drive', status: 'pending',
      safe_error: 'x', attempt_count: 0, retention_expires_at: new Date(Date.now() + 86_400_000), locked_until: null,
      locked_by: null, discarded_at: null, discarded_by: null, discard_reason: null, resolved_at: null,
    }).execute();
    const claimed = (await processing.claimAbandoned('s', new Date(Date.now() + min(5)), 200, 60_000)).map((c) => c.submissionId);
    expect(claimed).not.toContain(done.id);
    expect(claimed).not.toContain(waiting.id);
    expect(claimed).not.toContain(withCase.id);
  });

  describe('task queue', () => {
    it('claims due tasks even when the submission already has an active case and is already successful', async () => {
      const saved = await newSubmission();
      await db.updateTable('submission_processing').set({ status: 'success' }).where('submission_id', '=', saved.id).execute();
      await db.insertInto('submission_recoveries').values({
        id: `rec_${saved.id}`, submission_id: saved.id, target_id: 'davia-c11', stage: 'sheets', status: 'pending',
        safe_error: 'x', attempt_count: 0, retention_expires_at: new Date(Date.now() + 86_400_000), locked_until: null,
        locked_by: null, discarded_at: null, discarded_by: null, discard_reason: null, resolved_at: null,
      }).execute();
      await processing.enqueueTask({ submissionId: saved.id, kind: 'sheets_recount', runAt: new Date(Date.now() - 1000) });
      const tasks = await processing.claimDueTasks('w1', new Date(), 50, 120_000);
      expect(tasks.filter((t) => t.submissionId === saved.id)).toHaveLength(1);
    });

    it('does not return tasks that are not yet due', async () => {
      const saved = await newSubmission();
      await processing.enqueueTask({ submissionId: saved.id, kind: 'sheets_reconcile', runAt: new Date(Date.now() + min(60)) });
      const tasks = await processing.claimDueTasks('w1', new Date(), 50, 120_000);
      expect(tasks.map((t) => t.submissionId)).not.toContain(saved.id);
    });

    it('lets exactly one of two concurrent workers claim a task', async () => {
      const saved = await newSubmission();
      await processing.enqueueTask({ submissionId: saved.id, kind: 'sheets_reconcile', runAt: new Date(Date.now() - 1000) });
      const [a, b] = await Promise.all([
        processing.claimDueTasks('w-a', new Date(), 50, 120_000),
        processing.claimDueTasks('w-b', new Date(), 50, 120_000),
      ]);
      expect([...a, ...b].filter((t) => t.submissionId === saved.id)).toHaveLength(1);
    });

    it('reopens a task whose claim expired (crashed worker)', async () => {
      const saved = await newSubmission();
      await processing.enqueueTask({ submissionId: saved.id, kind: 'sheets_reconcile', runAt: new Date(Date.now() - 1000) });
      const first = await processing.claimDueTasks('w1', new Date(), 50, 120_000);
      expect(first.some((t) => t.submissionId === saved.id)).toBe(true);
      const again = await processing.claimDueTasks('w2', new Date(Date.now() + min(5)), 50, 120_000);
      expect(again.some((t) => t.submissionId === saved.id)).toBe(true);
    });

    it('is idempotent to enqueue the same task twice', async () => {
      const saved = await newSubmission();
      const runAt = new Date(Date.now() - 1000);
      await processing.enqueueTask({ submissionId: saved.id, kind: 'sheets_recount', runAt });
      await processing.enqueueTask({ submissionId: saved.id, kind: 'sheets_recount', runAt });
      const tasks = await processing.claimDueTasks('w1', new Date(), 50, 120_000);
      expect(tasks.filter((t) => t.submissionId === saved.id)).toHaveLength(1);
    });

    it('completed tasks are not claimed again; failed tasks are rescheduled with backoff and give up after 5 attempts', async () => {
      const saved = await newSubmission();
      await processing.enqueueTask({ submissionId: saved.id, kind: 'sheets_reconcile', runAt: new Date(Date.now() - 1000) });
      let task = (await processing.claimDueTasks('w1', new Date(), 50, 120_000)).find((t) => t.submissionId === saved.id)!;
      const outcome = await processing.failTask(task.id, 'w1', 'boom', new Date());
      expect(outcome).toBe('rescheduled');
      expect((await processing.claimDueTasks('w1', new Date(), 50, 120_000)).some((t) => t.id === task.id)).toBe(false);

      let last: 'rescheduled' | 'gave_up' = 'rescheduled';
      for (let i = 0; i < 6 && last === 'rescheduled'; i++) {
        const now = new Date(Date.now() + min(24 * 60 * (i + 1)));
        const claimed = (await processing.claimDueTasks('w1', now, 50, 120_000)).find((t) => t.id === task.id);
        if (!claimed) break;
        task = claimed;
        last = await processing.failTask(task.id, 'w1', 'boom', now);
      }
      expect(last).toBe('gave_up');
      expect(task.attempts).toBeGreaterThanOrEqual(5);

      const ok = await newSubmission();
      await processing.enqueueTask({ submissionId: ok.id, kind: 'sheets_recount', runAt: new Date(Date.now() - 1000) });
      const t2 = (await processing.claimDueTasks('w1', new Date(), 50, 120_000)).find((t) => t.submissionId === ok.id)!;
      expect(await processing.completeTask(t2.id, 'w1')).toBe(true);
      expect(await processing.completeTask(t2.id, 'w1')).toBe(false);
      expect((await processing.claimDueTasks('w1', new Date(Date.now() + min(600)), 50, 120_000)).some((t) => t.id === t2.id)).toBe(false);
    });
  });
});
