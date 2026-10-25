import { Kysely, sql } from 'kysely';

/** Registra si la preinscripción se validó contra WordPress en vivo o contra el catálogo guardado. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS catalog_validation varchar(16) NOT NULL DEFAULT 'live'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE submissions DROP COLUMN IF EXISTS catalog_validation`.execute(db);
}
