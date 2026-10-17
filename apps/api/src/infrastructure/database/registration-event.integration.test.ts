import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { createKyselyDb, type KyselyDb } from './kysely.js';
import { PostgresSubmissionRepository } from './postgres-submission-repository.js';
import { RegistrationEventDispatcher } from '../../application/registration-event-dispatcher.js';

const databaseUrl = process.env.REGISTRATION_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

integrationDescribe('registration event PostgreSQL integration', () => {
  let db: KyselyDb;
  let adminPool: pg.Pool;
  const clientSubmissionId = `regtest_${crypto.randomUUID()}`;
  const targetId = `regtest_${crypto.randomUUID()}`;

  beforeAll(async () => {
    db = createKyselyDb(databaseUrl);
    adminPool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await runMigrations(db);
  });

  afterAll(async () => {
    if (adminPool) {
      await adminPool.query('DELETE FROM submissions WHERE client_submission_id = $1', [clientSubmissionId]);
      await adminPool.query('DELETE FROM targets WHERE id = $1', [targetId]);
      await adminPool.end();
    }
    if (db) await db.destroy();
  });

  it('commits one stable event atomically with the effective submission and safely retries delivery', async () => {
    const repository = new PostgresSubmissionRepository(db);
    const record = {
      clientSubmissionId, targetId, configRevision: 'test-revision', targetTitle: 'Registration event test', targetKind: 'seminar',
      values: { email: ' User.Registration@Example.edu.uy ', firstName: 'Test' },
    };
    const first = await repository.saveOrGet(record);
    const replay = await repository.saveOrGet(record);
    expect(first.existing).toBe(false);
    expect(replay).toEqual({ id: first.id, existing: true });

    const outbox = await adminPool.query(
      'SELECT idempotency_key, payload_json, status FROM registration_event_outbox WHERE submission_id = $1', [first.id]
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({ idempotency_key: `preinsc_${first.id}`, status: 'pending' });
    expect(JSON.parse(outbox.rows[0].payload_json)).toMatchObject({
      event_type: 'registration.status.changed',
      data: { email: 'user.registration@example.edu.uy', target_id: targetId, submission_id: first.id },
    });
    expect(await repository.hasEffectiveRegistration('USER.REGISTRATION@example.edu.uy', targetId)).toBe(true);

    const accepted = new RegistrationEventDispatcher(db, {
      endpoint: 'https://mailing.example.test/api/v1/events/registrations', secret: 'test-secret',
      fetch: async (_url, init) => {
        expect(init.headers).toMatchObject({ 'Idempotency-Key': `preinsc_${first.id}` });
        expect(init.body).toBe(outbox.rows[0].payload_json);
        return new Response('{}', { status: 202 });
      },
    });
    expect(await accepted.runBatch()).toEqual({ status: 'completed', processed: 1 });
    const delivered = await adminPool.query(
      'SELECT status, payload_json, delivered_at FROM registration_event_outbox WHERE submission_id = $1', [first.id]
    );
    expect(delivered.rows[0].status).toBe('delivered');
    expect(delivered.rows[0].payload_json).toBe('{}');
    expect(delivered.rows[0].delivered_at).toBeTruthy();
  }, 30_000);

  it('retries transient upstream responses with an idempotent event body', async () => {
    const repository = new PostgresSubmissionRepository(db);
    const secondClientId = `${clientSubmissionId}_retry`;
    const secondTargetId = `${targetId}_retry`;
    try {
      const submission = await repository.saveOrGet({
        clientSubmissionId: secondClientId, targetId: secondTargetId, configRevision: 'test-revision',
        targetTitle: 'Retry event test', targetKind: 'seminar', values: { email: 'retry@example.edu.uy' },
      });
      const dispatcher = new RegistrationEventDispatcher(db, {
        endpoint: 'https://mailing.example.test/api/v1/events/registrations', secret: 'test-secret',
        fetch: async () => new Response('{}', { status: 503 }),
      });
      expect(await dispatcher.runBatch()).toEqual({ status: 'completed', processed: 1 });
      const failedAttempt = await adminPool.query(
        'SELECT status, attempt_count, last_error, payload_json FROM registration_event_outbox WHERE submission_id = $1', [submission.id]
      );
      expect(failedAttempt.rows[0]).toMatchObject({ status: 'pending', attempt_count: 1, last_error: 'upstream_http_503' });
      expect(failedAttempt.rows[0].payload_json).not.toBe('{}');
    } finally {
      await adminPool.query('DELETE FROM submissions WHERE client_submission_id = ANY($1)', [[secondClientId]]);
      await adminPool.query('DELETE FROM targets WHERE id = $1', [secondTargetId]);
    }
  }, 30_000);

  it('rolls back the submission if the required event cannot be recorded', async () => {
    const repository = new PostgresSubmissionRepository(db);
    const invalidClientId = `${clientSubmissionId}_invalid`;
    const invalidTargetId = `${targetId}_invalid`;
    await expect(repository.saveOrGet({
      clientSubmissionId: invalidClientId, targetId: invalidTargetId, configRevision: 'test-revision',
      targetTitle: 'Invalid registration event test', targetKind: 'seminar', values: { firstName: 'Missing email' },
    })).rejects.toThrow(/requires an email/i);
    const row = await adminPool.query('SELECT count(*)::int AS count FROM submissions WHERE client_submission_id = $1', [invalidClientId]);
    expect(row.rows[0].count).toBe(0);
    await adminPool.query('DELETE FROM targets WHERE id = $1', [invalidTargetId]);
  }, 30_000);
});
