import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Kysely } from 'kysely';
import { createKyselyDb } from '../kysely.js';
import { runMigrations } from '../migrate.js';

describe('014_smtp_email_settings migration', () => {
  const sourceUrl = new URL(
    process.env.SMTP_MIGRATION_TEST_DATABASE_URL
      ?? 'postgres://flacso:flacso_password@localhost:5433/flacso_preinscripciones',
  );
  const databaseName = `flacso_smtp_migration_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const testUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  testUrl.pathname = `/${databaseName}`;

  let db: Kysely<any> | undefined;
  let databaseCreated = false;

  beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      databaseCreated = true;
    } finally {
      await admin.end();
    }
    db = createKyselyDb(testUrl.toString());
  }, 30000);

  afterAll(async () => {
    await db?.destroy();
    if (!databaseCreated) return;

    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }, 30000);

  it('seeds non-secret SMTP defaults idempotently without changing legacy SES values', async () => {
    await runMigrations(db!);
    await db!
      .insertInto('system_settings')
      .values([
        { key: 'smtp_host', value: 'smtp.custom.example' },
        { key: 'ses_aws_access_key_id', value: 'legacy-access-key' },
        { key: 'ses_aws_secret_access_key', value: 'legacy-secret-key' },
      ])
      .onConflict((conflict) => conflict.column('key').doUpdateSet(({ ref }) => ({ value: ref('excluded.value') })))
      .execute();

    await runMigrations(db!);

    const rows = await db!
      .selectFrom('system_settings')
      .select(['key', 'value'])
      .execute();
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    expect(settings).toMatchObject({
      email_provider: 'smtp',
      smtp_host: 'smtp.custom.example',
      smtp_port: '587',
      smtp_security: 'starttls',
      smtp_username: '',
      email_from: '',
      email_reply_to: '',
      smtp_last_connection_test_at: '',
      smtp_last_connection_test_ok: '',
      smtp_last_connection_test_error: '',
      ses_aws_access_key_id: 'legacy-access-key',
      ses_aws_secret_access_key: 'legacy-secret-key',
    });
    expect(settings).not.toHaveProperty('smtp_password');
  });
});
