import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE target_spreadsheets ADD COLUMN IF NOT EXISTS root_folder_id varchar(255)`.execute(db);
  await sql`ALTER TABLE target_spreadsheets ADD COLUMN IF NOT EXISTS status varchar(50)`.execute(db);
  await sql`ALTER TABLE target_spreadsheets ADD COLUMN IF NOT EXISTS last_discovered_at timestamp`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('target_spreadsheets')
    .dropColumn('last_discovered_at')
    .dropColumn('status')
    .dropColumn('root_folder_id')
    .execute();
}
