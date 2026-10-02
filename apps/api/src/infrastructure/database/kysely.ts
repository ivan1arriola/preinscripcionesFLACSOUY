import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DatabaseSchema } from './schema.js';

export type KyselyDb = Kysely<DatabaseSchema>;

export function createKyselyDb(connectionString?: string): KyselyDb {
  const connection =
    connectionString ??
    process.env.DATABASE_URL ??
    'postgres://flacso:flacso_password@localhost:5432/flacso_preinscripciones';

  const dialect = new PostgresDialect({
    pool: new pg.Pool({
      connectionString: connection,
      max: 10,
    }),
  });

  return new Kysely<DatabaseSchema>({
    dialect,
  });
}
