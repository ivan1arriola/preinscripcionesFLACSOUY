import { Kysely, sql } from 'kysely';
import { getDefaultProfileDefinition, SUPPORTED_OFFER_TYPES, type SupportedOfferType } from '../../../domain/form-profiles.js';

const PROFILE_NAMES: Record<SupportedOfferType, string> = {
  maestria: 'Maestría',
  especializacion: 'Especialización',
  diplomado: 'Diplomado',
  diploma: 'Diploma',
  seminar: 'Seminario',
};

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

  // Seed default profiles and initial active versions
  for (const type of SUPPORTED_OFFER_TYPES) {
    const profileId = `profile_${type}`;
    const versionId = `ver_${type}_v1`;
    const name = PROFILE_NAMES[type];
    const definition = JSON.stringify(getDefaultProfileDefinition(type));

    await db
      .insertInto('form_profiles')
      .values({
        id: profileId,
        type,
        name,
        active_version_id: versionId,
      })
      .onConflict((oc) => oc.column('type').doNothing())
      .execute();

    await db
      .insertInto('form_profile_versions')
      .values({
        id: versionId,
        profile_id: profileId,
        version_number: 1,
        definition,
        created_by: 'system',
      })
      .onConflict((oc) => oc.columns(['profile_id', 'version_number']).doNothing())
      .execute();

    await db
      .updateTable('form_profiles')
      .set({ active_version_id: versionId })
      .where('id', '=', profileId)
      .where('active_version_id', 'is', null)
      .execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('submissions').dropColumn('profile_snapshot').execute();
  await db.schema.alterTable('submissions').dropColumn('profile_version_id').execute();
  await db.schema.dropTable('form_profile_audit_events').ifExists().execute();
  await db.schema.dropTable('form_profile_versions').ifExists().execute();
  await db.schema.dropTable('form_profiles').ifExists().execute();
  await db.schema.dropTable('admin_users').ifExists().execute();
}
