import { Kysely, sql } from 'kysely';

/**
 * Enlace de preinscripción de cada oferta académica, registrado la primera vez que
 * WordPress lo publica. Solo cambia si WordPress publica un valor distinto.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('offer_registration_links')
    .ifNotExists()
    .addColumn('offer_wp_id', 'integer', (column) => column.primaryKey())
    .addColumn('path', 'varchar(512)', (column) => column.notNull())
    .addColumn('registered_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (column) => column.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('offer_registration_links').ifExists().execute();
}
