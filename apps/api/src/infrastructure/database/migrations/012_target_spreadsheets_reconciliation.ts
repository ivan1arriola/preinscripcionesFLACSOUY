import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('target_spreadsheets')
    .addColumn('root_folder_id', 'varchar(255)')
    .addColumn('status', 'varchar(50)')
    .addColumn('last_discovered_at', 'timestamp')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('target_spreadsheets')
    .dropColumn('last_discovered_at')
    .dropColumn('status')
    .dropColumn('root_folder_id')
    .execute();
}
