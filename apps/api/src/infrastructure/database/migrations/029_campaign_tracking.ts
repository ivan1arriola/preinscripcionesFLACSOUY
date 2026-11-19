import { Kysely, sql } from 'kysely';

/**
 * Seguimiento de campañas: una fila por preinscripción enviada, con sólo los datos que
 * necesita el análisis (quién, a qué oferta/edición, y los parámetros utm_*).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('campaign_tracking')
    .ifNotExists()
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('submission_id', 'text', (column) => column.notNull().unique().references('submissions.id').onDelete('cascade'))
    .addColumn('nombre', 'text', (column) => column.notNull())
    .addColumn('apellido', 'text', (column) => column.notNull())
    .addColumn('correo', 'text', (column) => column.notNull())
    .addColumn('oferta', 'text', (column) => column.notNull())
    .addColumn('oferta_tipo', 'text', (column) => column.notNull())
    .addColumn('edicion', 'text')
    .addColumn('utm_source', 'text')
    .addColumn('utm_medium', 'text')
    .addColumn('utm_campaign', 'text')
    .addColumn('utm_term', 'text')
    .addColumn('utm_content', 'text')
    .addColumn('created_at', 'timestamptz', (column) => column.defaultTo(sql`now()`).notNull())
    .execute();
  await db.schema.createIndex('idx_campaign_tracking_created_at').ifNotExists().on('campaign_tracking').column('created_at').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('campaign_tracking').ifExists().execute();
}
