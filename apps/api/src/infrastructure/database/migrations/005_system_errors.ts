import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('system_errors')
    .ifNotExists()
    .addColumn('id', 'varchar(100)', (col) => col.primaryKey())
    .addColumn('severity', 'varchar(20)', (col) => col.notNull())
    .addColumn('origin', 'varchar(50)', (col) => col.notNull())
    .addColumn('code', 'varchar(100)', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('context', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('target_id', 'varchar(100)')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('unresolved'))
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('resolved_by', 'varchar(100)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('system_errors_status_created_idx')
    .ifNotExists()
    .on('system_errors')
    .columns(['status', 'created_at'])
    .execute();

  await db.schema
    .createIndex('system_errors_target_id_idx')
    .ifNotExists()
    .on('system_errors')
    .column('target_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('system_errors').ifExists().execute();
}
