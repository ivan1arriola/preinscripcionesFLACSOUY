import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('submission_processing')
    .ifNotExists()
    .addColumn('submission_id', 'varchar(64)', (col) =>
      col.references('submissions.id').onDelete('cascade').primaryKey()
    )
    .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('error_message', 'text')
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('submission_processing').ifExists().execute();
}
