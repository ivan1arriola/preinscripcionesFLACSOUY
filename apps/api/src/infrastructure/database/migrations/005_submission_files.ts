import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('submission_files')
    .ifNotExists()
    .addColumn('token', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('submission_id', 'varchar(64)', (col) => col.references('submissions.id').onDelete('cascade').notNull())
    .addColumn('field_key', 'varchar(100)', (col) => col.notNull())
    .addColumn('original_name', 'varchar(500)', (col) => col.notNull())
    .addColumn('mime_type', 'varchar(150)', (col) => col.notNull())
    .addColumn('size', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('drive_file_id', 'varchar(255)')
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema.createIndex('idx_submission_files_submission').on('submission_files').column('submission_id').ifNotExists().execute();
  await db.schema.createIndex('idx_submission_files_status').on('submission_files').column('status').ifNotExists().execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('submission_files').ifExists().execute();
}
