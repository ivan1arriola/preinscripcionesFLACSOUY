import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('registration_event_outbox')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (column) => column.primaryKey())
    .addColumn('submission_id', 'varchar(255)', (column) =>
      column.references('submissions.id').onDelete('cascade').notNull()
    )
    .addColumn('idempotency_key', 'varchar(255)', (column) => column.notNull().unique())
    .addColumn('payload_json', 'text', (column) => column.notNull())
    .addColumn('status', 'varchar(32)', (column) => column.defaultTo('pending').notNull())
    .addColumn('attempt_count', 'integer', (column) => column.defaultTo(0).notNull())
    .addColumn('available_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('locked_until', 'timestamp')
    .addColumn('locked_by', 'varchar(255)')
    .addColumn('last_error', 'text')
    .addColumn('delivered_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex('idx_registration_outbox_claim')
    .on('registration_event_outbox').columns(['status', 'available_at', 'created_at']).ifNotExists().execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('registration_event_outbox').ifExists().execute();
}
