import { Kysely, sql } from 'kysely';

/** El índice de la migración 020 sólo servía al endpoint de verificación de FLACSO Mailing, ya eliminado. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_submission_values_email_lookup`.execute(db);
}

export async function down(): Promise<void> {
  // Sin vuelta atrás: el endpoint que lo usaba ya no existe.
}
