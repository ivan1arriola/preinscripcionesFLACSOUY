import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('upload_sessions')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('last_activity_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createTable('upload_session_files')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('session_id', 'varchar(64)', (col) =>
      col.references('upload_sessions.id').onDelete('cascade').notNull()
    )
    .addColumn('original_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('mime_type', 'varchar(100)', (col) => col.notNull())
    .addColumn('size_bytes', 'integer', (col) => col.notNull())
    .addColumn('storage_path', 'varchar(500)', (col) => col.notNull())
    .addColumn('uploaded_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_upload_sessions_last_activity')
    .on('upload_sessions')
    .column('last_activity_at')
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('upload_session_files').ifExists().execute();
  await db.schema.dropTable('upload_sessions').ifExists().execute();
}
