import { Kysely, sql } from 'kysely';

/**
 * Instantánea de la fila de Sheets (plan de robustez, P3).
 * La reconciliación de un intento incierto necesita volver a insertar exactamente la misma fila, incluidos los
 * enlaces de Drive; guardarla evita reconstruirla. Los valores personales se vacían al confirmarse la escritura.
 * Solo agrega una columna nula que el código anterior ignora.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE submission_processing ADD COLUMN IF NOT EXISTS sheet_payload jsonb`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE submission_processing DROP COLUMN IF EXISTS sheet_payload`.execute(db);
}
