import { createApp } from './presentation/http/app.js';
import { FixtureAcademicCatalog } from './infrastructure/fixtures/fixture-academic-catalog.js';
import { PostgresSubmissionRepository } from './infrastructure/database/postgres-submission-repository.js';
import { createKyselyDb } from './infrastructure/database/kysely.js';
import { runMigrations } from './infrastructure/database/migrate.js';
import { sql } from 'kysely';

import { WordPressClient } from './infrastructure/wordpress/wordpress-client.js';
import { WordPressAcademicCatalog } from './infrastructure/wordpress/wordpress-academic-catalog.js';
import { PostgresWordPressCache } from './infrastructure/wordpress/wordpress-cache.js';

import { PostgresSystemErrorRepository } from './infrastructure/database/postgres-system-error-repository.js';
import { AdminAuthService } from './infrastructure/auth/admin-auth.js';
import { AdminService } from './application/admin/admin-service.js';

const port = Number(process.env.PORT || 3000);
const db = createKyselyDb();

const catalog = process.env.WORDPRESS_URL
  ? new WordPressAcademicCatalog(
      new WordPressClient({ baseUrl: process.env.WORDPRESS_URL }),
      new PostgresWordPressCache(db)
    )
  : new FixtureAcademicCatalog();

const repository = new PostgresSubmissionRepository(db);
const errorRepository = new PostgresSystemErrorRepository(db);
const authService = new AdminAuthService();

const checkDb = async () => {
  try {
    await sql`SELECT 1`.execute(db);
    return true;
  } catch {
    return false;
  }
};

const adminService = new AdminService({
  catalog,
  errorRepo: errorRepository,
  db,
  checkDatabase: checkDb,
});

// Attempt migration on startup if database is accessible
try {
  await runMigrations(db);
} catch (err) {
  console.warn('Could not run migrations on startup (database might be initializing or degraded):', err);
}

const app = createApp({
  catalog,
  repository,
  errorRepository,
  authService,
  adminService,
  checkDatabase: checkDb,
});

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
