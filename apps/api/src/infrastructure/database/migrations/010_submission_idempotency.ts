import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS client_submission_id varchar(128)`.execute(db);

  await db.schema
    .createIndex('idx_submissions_client_submission_id')
    .ifNotExists()
    .unique()
    .on('submissions')
    .column('client_submission_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_submissions_client_submission_id')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('submissions')
    .dropColumn('client_submission_id')
    .execute();
}
