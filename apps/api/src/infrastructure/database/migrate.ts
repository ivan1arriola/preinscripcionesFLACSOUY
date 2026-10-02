import { createKyselyDb } from './kysely.js';
import * as initialSchema from './migrations/001_initial_schema.js';
import * as wordpressCacheSchema from './migrations/002_wordpress_cache.js';
import * as spreadsheetOperationsSchema from './migrations/003_spreadsheet_operations.js';
import * as uploadSessionsSchema from './migrations/004_upload_sessions.js';
import * as systemErrorsSchema from './migrations/005_system_errors.js';

export async function runMigrations(db = createKyselyDb()): Promise<void> {
  console.log('Running migrations...');
  await initialSchema.up(db);
  await wordpressCacheSchema.up(db);
  await spreadsheetOperationsSchema.up(db);
  await uploadSessionsSchema.up(db);
  await systemErrorsSchema.up(db);
  console.log('Migrations complete.');
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  const db = createKyselyDb();
  runMigrations(db)
    .then(async () => {
      await db.destroy();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await db.destroy();
      process.exit(1);
    });
}
