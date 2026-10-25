import { Kysely, sql } from 'kysely';

/** Acelera hasEffectiveRegistration: busca el email normalizado de una submission. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_submission_values_email_lookup
    ON submission_values (lower(trim(value)), submission_id)
    WHERE input_key = 'email'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_submission_values_email_lookup`.execute(db);
}
