import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createKyselyDb } from '../infrastructure/database/kysely.js';
import { runMigrations } from '../infrastructure/database/migrate.js';
import { PostgresSubmissionRepository } from '../infrastructure/database/postgres-submission-repository.js';
import { createSweepDependencies } from '../infrastructure/sweep-runtime.js';
import { sweepOnce } from './sweep-abandoned-submissions.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

integrationDescribe('sweepOnce (Integration with PostgreSQL)', () => {
  const db = createKyselyDb(dbUrl);
  const submissions = new PostgresSubmissionRepository(db);

  beforeAll(async () => {
    await runMigrations(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    // La base de pruebas acumula envíos pendientes de otras suites: el lote del barrido es acotado.
    await db.updateTable('submission_processing').set({ status: 'success' }).where('status', '=', 'pending').execute();
  });

  async function abandonedSubmission() {
    const saved = await submissions.saveOrGet({
      clientSubmissionId: `sweep-${Math.random().toString(36).slice(2)}`,
      targetId: 'davia-c11', configRevision: 'v1', targetTitle: 'DAVIA', targetKind: 'academic_offer',
      values: { email: 'a@example.com' },
    } as never);
    // El procesador murió: el lease venció hace rato.
    await db.updateTable('submission_processing')
      .set({ lease_expires_at: new Date(Date.now() - 10 * 60_000) })
      .where('submission_id', '=', saved.id).execute();
    return saved.id;
  }

  it('turns an abandoned submission into a visible case exactly once, even across repeated sweeps', async () => {
    const id = await abandonedSubmission();
    const deps = createSweepDependencies(db);

    const dry = await sweepOnce(deps, { owner: 's', now: new Date(), dryRun: true });
    expect(dry.abandoned.map((a) => a.submissionId)).toContain(id);
    expect(await db.selectFrom('submission_recoveries').select('id').where('submission_id', '=', id).execute()).toHaveLength(0);

    const first = await sweepOnce(deps, { owner: 's1', now: new Date() });
    expect(first.abandoned.map((a) => a.submissionId)).toContain(id);
    const cases = await db.selectFrom('submission_recoveries').selectAll().where('submission_id', '=', id).execute();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ stage: 'unknown', status: 'pending', target_id: 'davia-c11' });
    const processing = await db.selectFrom('submission_processing').select('status').where('submission_id', '=', id).executeTakeFirstOrThrow();
    expect(processing.status).toBe('failed');

    const second = await sweepOnce(deps, { owner: 's2', now: new Date() });
    expect(second.abandoned.map((a) => a.submissionId)).not.toContain(id);
    expect(await db.selectFrom('submission_recoveries').select('id').where('submission_id', '=', id).execute()).toHaveLength(1);
  });

  it('two simultaneous sweepers produce a single case', async () => {
    const id = await abandonedSubmission();
    const deps = createSweepDependencies(db);
    await Promise.all([
      sweepOnce(deps, { owner: 'a', now: new Date() }),
      sweepOnce(deps, { owner: 'b', now: new Date() }),
    ]);
    expect(await db.selectFrom('submission_recoveries').select('id').where('submission_id', '=', id).execute()).toHaveLength(1);
  });
});
