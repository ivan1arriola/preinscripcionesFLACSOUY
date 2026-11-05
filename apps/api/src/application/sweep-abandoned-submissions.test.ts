import { describe, expect, it } from 'vitest';
import { sweepOnce } from './sweep-abandoned-submissions.js';
import type { CreateRecoveryInput } from '../ports/submission-recovery-repository.js';
import type {
  AbandonedSubmission,
  SubmissionProcessingRepository,
  SubmissionTask,
} from '../ports/submission-processing-repository.js';

function fakes(options: { abandoned?: AbandonedSubmission[]; tasks?: SubmissionTask[]; failOutcome?: 'rescheduled' | 'gave_up' } = {}) {
  const calls = {
    claimAbandoned: 0, listAbandoned: 0, claimDueTasks: 0,
    completed: [] as string[], failed: [] as string[], cases: [] as CreateRecoveryInput[],
    processing: [] as Array<[string, string, string | undefined]>,
  };
  const processing: Pick<SubmissionProcessingRepository, 'claimAbandoned' | 'listAbandoned' | 'claimDueTasks' | 'completeTask' | 'failTask'> = {
    async claimAbandoned() { calls.claimAbandoned++; return options.abandoned ?? []; },
    async listAbandoned() { calls.listAbandoned++; return options.abandoned ?? []; },
    async claimDueTasks() { calls.claimDueTasks++; return options.tasks ?? []; },
    async completeTask(id) { calls.completed.push(id); return true; },
    async failTask(id) { calls.failed.push(id); return options.failOutcome ?? 'rescheduled'; },
  };
  const recovery = {
    async recordFailure(input: CreateRecoveryInput) { calls.cases.push(input); return { id: `rec-${calls.cases.length}` }; },
  };
  const submissions = {
    async markProcessing(id: string, status: 'failed', error?: string) { calls.processing.push([id, status, error]); },
  };
  return { calls, deps: { processing, recovery, submissions } };
}

const abandoned = (n: number, legacy = false): AbandonedSubmission => ({ submissionId: `sub-${n}`, targetId: 'davia', legacy });
const task = (id: string, kind: SubmissionTask['kind'] = 'sheets_reconcile'): SubmissionTask => ({
  id, submissionId: 'sub-1', kind, runAt: new Date(), attempts: 1,
});

describe('sweepOnce', () => {
  it('creates an unknown-stage case and marks the submission failed for each abandoned submission', async () => {
    const { calls, deps } = fakes({ abandoned: [abandoned(1), abandoned(2, true)] });
    const summary = await sweepOnce(deps, { owner: 'sweeper', now: new Date() });
    expect(summary.abandoned.map((a) => a.submissionId)).toEqual(['sub-1', 'sub-2']);
    expect(calls.cases).toHaveLength(2);
    expect(calls.cases[0]).toMatchObject({ submissionId: 'sub-1', targetId: 'davia', stage: 'unknown', retentionDays: 7 });
    expect(String(calls.cases[0]?.safeError)).toMatch(/interrump|abandon|proces/i);
    expect(calls.processing.map(([id, status]) => [id, status])).toEqual([['sub-1', 'failed'], ['sub-2', 'failed']]);
  });

  it('in dry-run mode lists without claiming, writing cases or touching the queue', async () => {
    const { calls, deps } = fakes({ abandoned: [abandoned(1)], tasks: [task('t1')] });
    const summary = await sweepOnce(deps, {
      owner: 'sweeper', now: new Date(), dryRun: true,
      executors: { sheets_reconcile: async () => {} },
    });
    expect(summary.abandoned).toHaveLength(1);
    expect(calls.listAbandoned).toBe(1);
    expect(calls.claimAbandoned).toBe(0);
    expect(calls.claimDueTasks).toBe(0);
    expect(calls.cases).toHaveLength(0);
    expect(calls.processing).toHaveLength(0);
  });

  it('does not claim tasks when no executors are configured (it would burn their attempts)', async () => {
    const { calls, deps } = fakes({ tasks: [task('t1')] });
    const summary = await sweepOnce(deps, { owner: 'sweeper', now: new Date() });
    expect(calls.claimDueTasks).toBe(0);
    expect(summary.dueTasks).toBe(0);
  });

  it('runs due tasks with their executor and completes them', async () => {
    const { calls, deps } = fakes({ tasks: [task('t1'), task('t2', 'sheets_recount')] });
    const ran: string[] = [];
    const summary = await sweepOnce(deps, {
      owner: 'sweeper', now: new Date(),
      executors: {
        sheets_reconcile: async (t) => { ran.push(`reconcile:${t.id}`); },
        sheets_recount: async (t) => { ran.push(`recount:${t.id}`); },
      },
    });
    expect(ran).toEqual(['reconcile:t1', 'recount:t2']);
    expect(calls.completed).toEqual(['t1', 't2']);
    expect(summary.dueTasks).toBe(2);
  });

  it('reschedules a failing task and, when it gives up, leaves a visible task_failed case', async () => {
    const reschedule = fakes({ tasks: [task('t1')], failOutcome: 'rescheduled' });
    await sweepOnce(reschedule.deps, {
      owner: 's', now: new Date(), executors: { sheets_reconcile: async () => { throw new Error('boom'); } },
    });
    expect(reschedule.calls.failed).toEqual(['t1']);
    expect(reschedule.calls.cases).toHaveLength(0);

    const giveUp = fakes({ tasks: [task('t1')], failOutcome: 'gave_up' });
    await sweepOnce(giveUp.deps, {
      owner: 's', now: new Date(), executors: { sheets_reconcile: async () => { throw new Error('boom'); } },
    });
    expect(giveUp.calls.cases).toHaveLength(1);
    expect(giveUp.calls.cases[0]).toMatchObject({ submissionId: 'sub-1', stage: 'task_failed' });
  });

  it('one failing submission does not stop the rest of the sweep', async () => {
    const { calls, deps } = fakes({ abandoned: [abandoned(1), abandoned(2)] });
    let first = true;
    const originalRecord = deps.recovery.recordFailure;
    deps.recovery.recordFailure = async (input) => {
      if (first) { first = false; throw new Error('db caída'); }
      return originalRecord(input);
    };
    const summary = await sweepOnce(deps, { owner: 's', now: new Date() });
    expect(calls.cases.map((c) => c.submissionId)).toEqual(['sub-2']);
    expect(summary.errors).toHaveLength(1);
  });
});
