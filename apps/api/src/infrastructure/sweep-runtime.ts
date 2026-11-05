import crypto from 'node:crypto';
import type { KyselyDb } from './database/kysely.js';
import { PostgresSubmissionRepository } from './database/postgres-submission-repository.js';
import { PostgresSubmissionProcessingRepository } from './database/postgres-submission-processing-repository.js';
import { PostgresSubmissionRecoveryRepository } from './database/postgres-submission-recovery-repository.js';
import type { SweepDependencies } from '../application/sweep-abandoned-submissions.js';

/** Arma las dependencias del barrido; las comparten el worker de `main.ts` y el comando `sweep:once`. */
export function createSweepDependencies(db: KyselyDb, recoveryRepository?: PostgresSubmissionRecoveryRepository): SweepDependencies {
  return {
    processing: new PostgresSubmissionProcessingRepository(db),
    recovery: recoveryRepository ?? new PostgresSubmissionRecoveryRepository(db),
    submissions: new PostgresSubmissionRepository(db),
  };
}

/** Identificador de este proceso en arriendos y reclamos. */
export function newSweeperId(prefix = 'sweeper'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
