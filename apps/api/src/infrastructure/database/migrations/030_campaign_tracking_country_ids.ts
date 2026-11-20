import { Kysely, sql } from 'kysely';

/** Suma país de residencia y los identificadores utm_id / fbclid al seguimiento de campañas. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE campaign_tracking ADD COLUMN IF NOT EXISTS pais text, ADD COLUMN IF NOT EXISTS utm_id text, ADD COLUMN IF NOT EXISTS fbclid text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE campaign_tracking DROP COLUMN IF EXISTS pais, DROP COLUMN IF EXISTS utm_id, DROP COLUMN IF EXISTS fbclid`.execute(db);
}
