import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('email_notifications')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('submission_id', 'varchar(255)', (col) =>
      col.references('submissions.id').onDelete('cascade').notNull()
    )
    .addColumn('audience', 'varchar(50)', (col) => col.notNull())
    .addColumn('recipient_email', 'varchar(255)', (col) => col.notNull())
    .addColumn('target_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('template_version', 'varchar(100)', (col) => col.notNull())
    .addColumn('payload_json', 'text', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.defaultTo('pending').notNull())
    .addColumn('attempt_count', 'integer', (col) => col.defaultTo(0).notNull())
    .addColumn('provider_message_id', 'varchar(255)')
    .addColumn('last_error', 'text')
    .addColumn('available_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('locked_until', 'timestamp')
    .addColumn('sent_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_email_notifications_unique_delivery')
    .on('email_notifications')
    .columns(['submission_id', 'audience', 'recipient_email', 'template_version'])
    .unique()
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex('idx_email_notifications_pending_dispatch')
    .on('email_notifications')
    .columns(['status', 'available_at'])
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex('idx_email_notifications_submission_id')
    .on('email_notifications')
    .column('submission_id')
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('email_notifications').ifExists().execute();
}
