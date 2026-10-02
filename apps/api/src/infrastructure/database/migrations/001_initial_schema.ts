import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Targets table
  await db.schema
    .createTable('targets')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('kind', 'varchar(50)', (col) => col.notNull())
    .addColumn('title', 'varchar(500)', (col) => col.notNull())
    .addColumn('config_revision', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  // 2. Input definitions table
  await db.schema
    .createTable('input_definitions')
    .ifNotExists()
    .addColumn('key', 'varchar(100)', (col) => col.primaryKey())
    .addColumn('label', 'varchar(255)', (col) => col.notNull())
    .addColumn('type', 'varchar(50)', (col) => col.notNull())
    .addColumn('required_by_default', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('spreadsheet_column', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  // 3. Target inputs relation table (composite PK)
  await db.schema
    .createTable('target_inputs')
    .ifNotExists()
    .addColumn('target_id', 'varchar(255)', (col) =>
      col.references('targets.id').onDelete('cascade').notNull()
    )
    .addColumn('input_key', 'varchar(100)', (col) =>
      col.references('input_definitions.key').onDelete('cascade').notNull()
    )
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('required', 'boolean', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_target_inputs', ['target_id', 'input_key'])
    .execute();

  // 4. Orientations table
  await db.schema
    .createTable('orientations')
    .ifNotExists()
    .addColumn('id', 'varchar(100)', (col) => col.primaryKey())
    .addColumn('target_id', 'varchar(255)', (col) =>
      col.references('targets.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .execute();

  // 5. Mentions table
  await db.schema
    .createTable('mentions')
    .ifNotExists()
    .addColumn('id', 'varchar(100)', (col) => col.primaryKey())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .execute();

  // 6. Orientation mentions relation table (composite PK)
  await db.schema
    .createTable('orientation_mentions')
    .ifNotExists()
    .addColumn('orientation_id', 'varchar(100)', (col) =>
      col.references('orientations.id').onDelete('cascade').notNull()
    )
    .addColumn('mention_id', 'varchar(100)', (col) =>
      col.references('mentions.id').onDelete('cascade').notNull()
    )
    .addPrimaryKeyConstraint('pk_orientation_mentions', ['orientation_id', 'mention_id'])
    .execute();

  // 7. Submissions table
  await db.schema
    .createTable('submissions')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('target_id', 'varchar(255)', (col) =>
      col.references('targets.id').onDelete('restrict').notNull()
    )
    .addColumn('config_revision', 'varchar(255)', (col) => col.notNull())
    .addColumn('submitted_at', 'timestamp', (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
    )
    .execute();

  // 8. Submission values table (composite PK)
  await db.schema
    .createTable('submission_values')
    .ifNotExists()
    .addColumn('submission_id', 'varchar(64)', (col) =>
      col.references('submissions.id').onDelete('cascade').notNull()
    )
    .addColumn('input_key', 'varchar(100)', (col) =>
      col.references('input_definitions.key').onDelete('restrict').notNull()
    )
    .addColumn('value', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_submission_values', ['submission_id', 'input_key'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('submission_values').ifExists().execute();
  await db.schema.dropTable('submissions').ifExists().execute();
  await db.schema.dropTable('orientation_mentions').ifExists().execute();
  await db.schema.dropTable('mentions').ifExists().execute();
  await db.schema.dropTable('orientations').ifExists().execute();
  await db.schema.dropTable('target_inputs').ifExists().execute();
  await db.schema.dropTable('input_definitions').ifExists().execute();
  await db.schema.dropTable('targets').ifExists().execute();
}
