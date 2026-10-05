import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE telegram_recovery_alerts
    ADD COLUMN IF NOT EXISTS event_type varchar(50) DEFAULT 'recovery' NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE telegram_recovery_alerts
    ADD COLUMN IF NOT EXISTS dedupe_key varchar(255)
  `.execute(db);

  await sql`
    UPDATE telegram_recovery_alerts
    SET dedupe_key = submission_id || ':' || chat_id || ':' || COALESCE(event_type, 'recovery')
    WHERE dedupe_key IS NULL
  `.execute(db);

  await sql`
    ALTER TABLE telegram_recovery_alerts
    ALTER COLUMN dedupe_key SET NOT NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_telegram_recovery_alerts_dedupe_key')
    .on('telegram_recovery_alerts')
    .column('dedupe_key')
    .unique()
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_telegram_recovery_alerts_dedupe_key')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('telegram_recovery_alerts')
    .dropColumn('dedupe_key')
    .execute();

  await db.schema
    .alterTable('telegram_recovery_alerts')
    .dropColumn('event_type')
    .execute();
}
