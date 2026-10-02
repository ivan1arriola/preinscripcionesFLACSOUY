import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('system_settings')
    .ifNotExists()
    .addColumn('key', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_by', 'varchar(255)', (col) => col.defaultTo('system').notNull())
    .execute();

}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('system_settings').ifExists().execute();
}
