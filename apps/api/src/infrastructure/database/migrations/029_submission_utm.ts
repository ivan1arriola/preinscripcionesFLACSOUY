import { Kysely, sql } from 'kysely';

/** Parámetros UTM con los que llegó la persona (seguimiento de campañas). */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS utm jsonb`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE submissions DROP COLUMN IF EXISTS utm`.execute(db);
}
