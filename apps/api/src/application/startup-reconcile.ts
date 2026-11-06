import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../infrastructure/database/schema.js';
import type { TemporaryFileStoragePort } from '../ports/file-storage.js';
import type { SubmissionRecoveryRepository } from '../ports/submission-recovery-repository.js';
import type { SubmissionProcessingRepository } from '../ports/submission-processing-repository.js';

export interface StartupReconcileDependencies {
  db: Kysely<DatabaseSchema>;
  fileStorage: Pick<TemporaryFileStoragePort, 'adoptFiles'>;
  recoveryRepository: SubmissionRecoveryRepository;
  processingRepository: SubmissionProcessingRepository;
  now?: () => Date;
  logger?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface StartupReconcileSummary {
  reconciledCount: number;
  missingFilesCases: number;
  tasksEnqueued: number;
}

/**
 * Conciliación obligatoria en el arranque de la API (Release A/B) antes de iniciar la limpieza periódica.
 *
 * 1. Para cada preinscripción en 'pending' o 'failed' que sea heredada (protocol_version IS NULL)
 *    o que tenga un caso de recuperación activo (en 'pending' o 'retrying'), adopta sus archivos
 *    temporales pendientes hacia retained/.
 * 2. Si algún archivo no se encuentra ni en pendientes ni en retenidos, genera un caso visible
 *    con stage: 'files_missing' detallando los nombres de los archivos en safeError.
 * 3. A las filas heredadas les asigna next_attempt_at = now + 200 s y encola sheets_reconcile en
 *    la cola durable submission_tasks.
 *
 * Esta operación es estrictamente idempotente: si el contenedor se reinicia o se invoca múltiples
 * veces, no duplica casos de recuperación ni tareas diferidas.
 */
export async function startupReconcile(deps: StartupReconcileDependencies): Promise<StartupReconcileSummary> {
  const {
    db,
    fileStorage,
    recoveryRepository,
    processingRepository,
    now = () => new Date(),
    logger = console,
  } = deps;

  const currentTime = now();
  let missingFilesCases = 0;
  let tasksEnqueued = 0;

  // Seleccionar envíos candidatos: en pending o failed, que sean heredados o tengan caso activo
  const candidates = await db
    .selectFrom('submission_processing as sp')
    .innerJoin('submissions as s', 's.id', 'sp.submission_id')
    .select([
      'sp.submission_id as submissionId',
      'sp.status',
      'sp.protocol_version as protocolVersion',
      'sp.next_attempt_at as nextAttemptAt',
      's.target_id as targetId',
    ])
    .where('sp.status', 'in', ['pending', 'failed'])
    .where((eb) =>
      eb.or([
        eb('sp.protocol_version', 'is', null),
        eb.exists(
          eb
            .selectFrom('submission_recoveries as r')
            .select('r.id')
            .whereRef('r.submission_id', '=', 'sp.submission_id')
            .where('r.status', 'in', ['pending', 'retrying'])
        ),
      ])
    )
    .execute();

  for (const candidate of candidates) {
    // 1. Obtener archivos asociados al envío
    const files = await db
      .selectFrom('submission_files')
      .select(['token', 'original_name as originalName'])
      .where('submission_id', '=', candidate.submissionId)
      .execute();

    if (files.length > 0 && typeof fileStorage.adoptFiles === 'function') {
      const tokens = files.map((f) => f.token);
      const missingTokens = await fileStorage.adoptFiles(tokens);

      if (missingTokens.length > 0) {
        missingFilesCases++;
        const missingList = missingTokens.map((t) => {
          const file = files.find((f) => f.token === t);
          return file ? `${file.originalName} (${t})` : t;
        });

        const safeError = `Archivos ausentes en el almacenamiento (no encontrados en pendientes ni retenidos): ${missingList.join(', ')}`;
        logger.error(`[StartupReconcile] Envío ${candidate.submissionId} tiene archivos ausentes: ${missingList.join(', ')}`);

        await recoveryRepository.recordFailure({
          submissionId: candidate.submissionId,
          targetId: candidate.targetId,
          stage: 'files_missing',
          safeError,
          now: currentTime,
        });
      }
    }

    // 2. Para filas heredadas (protocol_version IS NULL): asignar next_attempt_at = now + 200 s y encolar sheets_reconcile
    if (candidate.protocolVersion === null) {
      // Idempotencia: verificar si ya existe una tarea sheets_reconcile pendiente para este envío
      const existingTask = await db
        .selectFrom('submission_tasks')
        .select(['run_at as runAt'])
        .where('submission_id', '=', candidate.submissionId)
        .where('kind', '=', 'sheets_reconcile')
        .where('done_at', 'is', null)
        .executeTakeFirst();

      if (!existingTask) {
        const runAt = candidate.nextAttemptAt && candidate.nextAttemptAt > currentTime
          ? candidate.nextAttemptAt
          : new Date(currentTime.getTime() + 200_000);

        await db
          .updateTable('submission_processing')
          .set({ next_attempt_at: runAt })
          .where('submission_id', '=', candidate.submissionId)
          .execute();

        await processingRepository.enqueueTask({
          submissionId: candidate.submissionId,
          kind: 'sheets_reconcile',
          runAt,
        });
        tasksEnqueued++;
      }
    }
  }

  return {
    reconciledCount: candidates.length,
    missingFilesCases,
    tasksEnqueued,
  };
}
