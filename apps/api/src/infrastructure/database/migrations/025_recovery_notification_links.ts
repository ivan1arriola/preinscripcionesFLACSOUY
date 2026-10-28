import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE submission_recoveries ADD COLUMN IF NOT EXISTS spreadsheet_url text`.execute(db);
  await sql`ALTER TABLE submission_recoveries ADD COLUMN IF NOT EXISTS documents_folder_url text`.execute(db);
}
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE submission_recoveries DROP COLUMN IF EXISTS documents_folder_url`.execute(db);
  await sql`ALTER TABLE submission_recoveries DROP COLUMN IF EXISTS spreadsheet_url`.execute(db);
}
