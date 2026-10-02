import { createKyselyDb } from './kysely.js';
import * as initialSchema from './migrations/001_initial_schema.js';
import * as wordpressCacheSchema from './migrations/002_wordpress_cache.js';
import * as spreadsheetOperationsSchema from './migrations/003_spreadsheet_operations.js';

export async function runMigrations(db = createKyselyDb()): Promise<void> {
  console.log('Running migrations...');
  await initialSchema.up(db);
  await wordpressCacheSchema.up(db);
  await spreadsheetOperationsSchema.up(db);
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
