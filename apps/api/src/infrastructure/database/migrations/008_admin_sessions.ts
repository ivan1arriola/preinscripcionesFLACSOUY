import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('admin_sessions')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', (col) => col.primaryKey())
    .addColumn('user_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)', (col) => col.notNull())
    .addColumn('user_data', 'jsonb', (col) => col.notNull())
    .addColumn('csrf_token', 'varchar(128)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('expires_at', 'timestamp', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('idx_admin_sessions_expires_at')
    .on('admin_sessions')
    .column('expires_at')
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('admin_sessions').ifExists().execute();
}
