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

  const initialFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e';

  await db
    .insertInto('system_settings')
    .values({
      key: 'google_drive_folder_id',
      value: initialFolderId,
      description: 'ID o URL de la carpeta de Google Drive donde se almacenan los archivos adjuntos de las preinscripciones',
      updated_by: 'system',
    })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('system_settings').ifExists().execute();
}
