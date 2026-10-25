import { Kysely, sql } from 'kysely';

/**
 * Outbox del aviso de inscripción a Mautic (POST /flacso/enrollments). El id es
 * el eventId del aviso, que Mautic usa para la idempotencia. El payload (email
 * y oferta) se vacía al confirmar el envío.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('mautic_enrollment_notify')
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
    .addColumn('notified_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex('idx_mautic_enrollment_notify_claim')
    .on('mautic_enrollment_notify').columns(['status', 'available_at']).ifNotExists().execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('mautic_enrollment_notify').ifExists().execute();
}
