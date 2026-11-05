import { Kysely, sql } from 'kysely';

/**
 * Protocolo de envío robusto (plan 2026-11-05-robustez-de-envios, P2 y P4).
 * Solo agrega: columnas nulas y tablas nuevas que el código anterior ignora, de modo que volver a la imagen
 * anterior es seguro.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Lease del procesador de cada envío y estado durable de las esperas de Sheets.
  await sql`ALTER TABLE submission_processing
    ADD COLUMN IF NOT EXISTS lease_owner varchar(80),
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamp,
    ADD COLUMN IF NOT EXISTS next_attempt_at timestamp,
    ADD COLUMN IF NOT EXISTS protocol_version integer,
    ADD COLUMN IF NOT EXISTS sheet_attempt_started_at timestamp,
    ADD COLUMN IF NOT EXISTS sheet_written_at timestamp`.execute(db);

  // ID reservado de Drive para crear cada archivo de forma condicional.
  await sql`ALTER TABLE submission_files ADD COLUMN IF NOT EXISTS drive_reserved_id varchar(128)`.execute(db);

  // Una fila por carpeta lógica de Drive: el ganador del INSERT decide el ID que usan todos.
  await db.schema
    .createTable('drive_folders')
    .ifNotExists()
    .addColumn('folder_key', 'text', (col) => col.primaryKey())
    .addColumn('drive_folder_id', 'varchar(128)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('confirmed_at', 'timestamp')
    .execute();

  // Cola durable de trabajo diferido (reconciliaciones y recuentos de Sheets), independiente de los casos.
  await db.schema
    .createTable('submission_tasks')
    .ifNotExists()
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('submission_id', 'varchar(64)', (col) => col.notNull().references('submissions.id').onDelete('cascade'))
    .addColumn('kind', 'varchar(40)', (col) => col.notNull())
    .addColumn('run_at', 'timestamp', (col) => col.notNull())
    .addColumn('claimed_by', 'varchar(80)')
    .addColumn('claimed_until', 'timestamp')
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('done_at', 'timestamp')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addUniqueConstraint('submission_tasks_unique_run', ['submission_id', 'kind', 'run_at'])
    .execute();

  await sql`CREATE INDEX IF NOT EXISTS submission_tasks_due_idx ON submission_tasks (run_at) WHERE done_at IS NULL`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS submission_processing_sweep_idx ON submission_processing (status, lease_expires_at)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('submission_tasks').ifExists().execute();
  await db.schema.dropTable('drive_folders').ifExists().execute();
  await sql`ALTER TABLE submission_files DROP COLUMN IF EXISTS drive_reserved_id`.execute(db);
  await sql`ALTER TABLE submission_processing
    DROP COLUMN IF EXISTS lease_owner, DROP COLUMN IF EXISTS lease_expires_at, DROP COLUMN IF EXISTS next_attempt_at,
    DROP COLUMN IF EXISTS protocol_version, DROP COLUMN IF EXISTS sheet_attempt_started_at,
    DROP COLUMN IF EXISTS sheet_written_at`.execute(db);
}
