import { createApp } from './presentation/http/app.js';
import { FixtureAcademicCatalog } from './infrastructure/fixtures/fixture-academic-catalog.js';
import { PostgresSubmissionRepository } from './infrastructure/database/postgres-submission-repository.js';
import { createKyselyDb } from './infrastructure/database/kysely.js';
import { runMigrations } from './infrastructure/database/migrate.js';
import { sql } from 'kysely';

const port = Number(process.env.PORT || 3000);
const db = createKyselyDb();

const catalog = new FixtureAcademicCatalog();
const repository = new PostgresSubmissionRepository(db);

// Attempt migration on startup if database is accessible
try {
  await runMigrations(db);
} catch (err) {
  console.warn('Could not run migrations on startup (database might be initializing or degraded):', err);
}

const app = createApp({
  catalog,
  repository,
  checkDatabase: async () => {
    try {
      await sql`SELECT 1`.execute(db);
      return true;
    } catch {
      return false;
    }
  },
});

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
