import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('temporary_uploads')
    .ifNotExists()
    .addColumn('token', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('session_id', 'varchar(128)', (col) => col.notNull())
    .addColumn('target_id', 'varchar(128)')
    .addColumn('field_key', 'varchar(64)', (col) => col.notNull())
    .addColumn('original_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('mime_type', 'varchar(128)', (col) => col.notNull())
    .addColumn('size', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('last_activity_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('idx_temporary_uploads_session_id')
    .ifNotExists()
    .on('temporary_uploads')
    .column('session_id')
    .execute();

  await db.schema
    .createIndex('idx_temporary_uploads_expires_at')
    .ifNotExists()
    .on('temporary_uploads')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('temporary_uploads').ifExists().execute();
}
