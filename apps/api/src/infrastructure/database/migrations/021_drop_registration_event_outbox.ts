import { Kysely, sql } from 'kysely';

/**
 * FLACSO Mailing ya no existe: se elimina el outbox de eventos de registro,
 * incluidos los eventos pendientes que guardaban el email del postulante.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS registration_event_outbox`.execute(db);
}

export async function down(): Promise<void> {
  // Sin vuelta atrás: los datos personales eliminados no se restauran.
}
