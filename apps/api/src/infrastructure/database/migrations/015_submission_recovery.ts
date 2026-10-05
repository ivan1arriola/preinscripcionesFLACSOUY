import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('submission_recoveries')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('submission_id', 'varchar(255)', (col) =>
      col.references('submissions.id').onDelete('cascade').notNull()
    )
    .addColumn('target_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('stage', 'varchar(50)', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.defaultTo('pending').notNull())
    .addColumn('safe_error', 'text', (col) => col.notNull())
    .addColumn('attempt_count', 'integer', (col) => col.defaultTo(1).notNull())
    .addColumn('first_failed_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('last_attempt_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('retention_expires_at', 'timestamp', (col) => col.notNull())
    .addColumn('locked_until', 'timestamp')
    .addColumn('locked_by', 'varchar(255)')
    .addColumn('discarded_at', 'timestamp')
    .addColumn('discarded_by', 'varchar(255)')
    .addColumn('discard_reason', 'text')
    .addColumn('resolved_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_submission_recoveries_submission_id')
    .on('submission_recoveries')
    .column('submission_id')
    .unique()
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex('idx_submission_recoveries_status_expiry')
    .on('submission_recoveries')
    .columns(['status', 'retention_expires_at'])
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex('idx_submission_recoveries_target_id')
    .on('submission_recoveries')
    .column('target_id')
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex('idx_submission_recoveries_created_at')
    .on('submission_recoveries')
    .column('created_at')
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('submission_recoveries').ifExists().execute();
}
