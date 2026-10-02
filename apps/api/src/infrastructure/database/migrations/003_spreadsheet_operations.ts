import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('target_spreadsheets')
    .ifNotExists()
    .addColumn('target_id', 'varchar(255)', (col) =>
      col.references('targets.id').onDelete('cascade').primaryKey()
    )
    .addColumn('spreadsheet_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('sheet_name', 'varchar(100)', (col) => col.defaultTo('Sheet1').notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createTable('spreadsheet_operations')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('submission_id', 'varchar(64)', (col) =>
      col.references('submissions.id').onDelete('cascade').notNull()
    )
    .addColumn('target_id', 'varchar(255)', (col) =>
      col.references('targets.id').onDelete('cascade').notNull()
    )
    .addColumn('spreadsheet_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.notNull())
    .addColumn('error_message', 'text')
    .addColumn('updated_range', 'varchar(100)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_spreadsheet_operations_status')
    .on('spreadsheet_operations')
    .column('status')
    .ifNotExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('spreadsheet_operations').ifExists().execute();
  await db.schema.dropTable('target_spreadsheets').ifExists().execute();
}
