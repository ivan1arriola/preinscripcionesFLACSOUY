import { Kysely, sql } from 'kysely';

/**
 * Outbox de sincronización del contacto del postulante con Mautic. El payload
 * (perfil estable y tags) se vacía al confirmar la sincronización.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('mautic_contact_sync')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (column) => column.primaryKey())
    .addColumn('submission_id', 'varchar(255)', (column) =>
      column.references('submissions.id').onDelete('cascade').notNull().unique()
    )
    .addColumn('payload_json', 'text', (column) => column.notNull())
    .addColumn('status', 'varchar(32)', (column) => column.defaultTo('pending').notNull())
    .addColumn('attempt_count', 'integer', (column) => column.defaultTo(0).notNull())
    .addColumn('available_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('locked_until', 'timestamp')
    .addColumn('locked_by', 'varchar(255)')
    .addColumn('last_error', 'text')
    .addColumn('mautic_contact_id', 'integer')
    .addColumn('synced_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex('idx_mautic_contact_sync_claim')
    .on('mautic_contact_sync').columns(['status', 'available_at']).ifNotExists().execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('mautic_contact_sync').ifExists().execute();
}
