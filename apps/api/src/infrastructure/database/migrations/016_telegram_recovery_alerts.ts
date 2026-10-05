import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('telegram_recovery_alerts')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('recovery_id', 'varchar(255)', (col) =>
      col.references('submission_recoveries.id').onDelete('set null')
    )
    .addColumn('submission_id', 'varchar(255)', (col) =>
      col.references('submissions.id').onDelete('cascade').notNull()
    )
    .addColumn('chat_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.defaultTo('pending').notNull())
    .addColumn('attempt_count', 'integer', (col) => col.defaultTo(0).notNull())
    .addColumn('max_attempts', 'integer', (col) => col.defaultTo(5).notNull())
    .addColumn('available_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('locked_until', 'timestamp')
    .addColumn('locked_by', 'varchar(255)')
    .addColumn('provider_message_id', 'varchar(255)')
    .addColumn('last_error', 'text')
    .addColumn('sent_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_telegram_recovery_alerts_status_available')
    .on('telegram_recovery_alerts')
    .columns(['status', 'available_at'])
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex('idx_telegram_recovery_alerts_submission_id')
    .on('telegram_recovery_alerts')
    .column('submission_id')
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex('idx_telegram_recovery_alerts_recovery_id')
    .on('telegram_recovery_alerts')
    .column('recovery_id')
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('telegram_recovery_alerts').ifExists().execute();
}
