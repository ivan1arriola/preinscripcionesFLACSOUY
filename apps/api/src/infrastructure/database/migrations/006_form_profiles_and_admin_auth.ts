import { Kysely, sql } from 'kysely';
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('admin_users')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('google_subject', 'varchar(255)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('picture_url', 'text')
    .addColumn('role', 'varchar(32)', (col) => col.notNull().defaultTo('admin'))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('last_login_at', 'timestamp')
    .execute();

  await db.schema
    .createTable('form_profiles')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('type', 'varchar(32)', (col) => col.notNull().unique())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('active_version_id', 'varchar(64)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createTable('form_profile_versions')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('profile_id', 'varchar(64)', (col) => col.references('form_profiles.id').onDelete('cascade').notNull())
    .addColumn('version_number', 'integer', (col) => col.notNull())
    .addColumn('definition', 'jsonb', (col) => col.notNull())
    .addColumn('created_by', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_profile_version_unique')
    .on('form_profile_versions')
    .columns(['profile_id', 'version_number'])
    .unique()
    .ifNotExists()
    .execute();

  await db.schema
    .createTable('form_profile_audit_events')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('profile_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('version_id', 'varchar(64)')
    .addColumn('action', 'varchar(64)', (col) => col.notNull())
    .addColumn('actor_email', 'varchar(255)', (col) => col.notNull())
    .addColumn('details', 'jsonb')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();

  // Additive columns to submissions
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS profile_version_id varchar(64)`.execute(db);
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS profile_snapshot jsonb`.execute(db);

  // Seed default admin user
  await db
    .insertInto('admin_users')
    .values({
      id: 'admin_flacso_web',
      google_subject: 'bootstrap_web_flacso',
      email: 'web@flacso.edu.uy',
      name: 'Webmaster FLACSO Uruguay',
      role: 'admin',
    })
    .onConflict((oc) => oc.column('email').doNothing())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('submissions').dropColumn('profile_snapshot').execute();
  await db.schema.alterTable('submissions').dropColumn('profile_version_id').execute();
  await db.schema.dropTable('form_profile_audit_events').ifExists().execute();
  await db.schema.dropTable('form_profile_versions').ifExists().execute();
  await db.schema.dropTable('form_profiles').ifExists().execute();
  await db.schema.dropTable('admin_users').ifExists().execute();
}
