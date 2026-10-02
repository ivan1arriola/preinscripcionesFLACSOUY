import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('technical_cache')
    .ifNotExists()
    .addColumn('key', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('payload', 'text', (col) => col.notNull())
    .addColumn('cached_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('expires_at', 'timestamp', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('idx_technical_cache_expires_at')
    .on('technical_cache')
    .column('expires_at')
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('technical_cache').ifExists().execute();
}
