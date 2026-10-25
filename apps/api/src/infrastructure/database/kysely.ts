import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DatabaseSchema } from './schema.js';

export type KyselyDb = Kysely<DatabaseSchema>;

export function createKyselyDb(connectionString?: string): KyselyDb {
  const port = process.env.POSTGRES_PORT || process.env.PGPORT || '5433';
  const connection =
    connectionString ??
    process.env.DATABASE_URL ??
    `postgres://flacso:flacso_password@localhost:${port}/flacso_preinscripciones`;

  const pool = new pg.Pool({
    connectionString: connection,
    max: 10,
  });
  // Sin este manejador, una conexión inactiva que PostgreSQL cierra emite un 'error' sin escuchar y mata el proceso.
  pool.on('error', (error) => {
    console.error('[DB] Error en una conexión inactiva del pool:', error.message);
  });

  const dialect = new PostgresDialect({ pool });

  return new Kysely<DatabaseSchema>({
    dialect,
  });
}
