import type {
  AbandonedSubmission,
  SubmissionProcessingRepository,
  SubmissionTask,
  SubmissionTaskKind,
} from '../ports/submission-processing-repository.js';
import type { CreateRecoveryInput } from '../ports/submission-recovery-repository.js';

const LEASE_TTL_MS = 60_000;
const TASK_CLAIM_TTL_MS = 2 * 60_000;
const BATCH = 25;

export interface SweepDependencies {
  processing: Pick<
    SubmissionProcessingRepository,
    'claimAbandoned' | 'listAbandoned' | 'claimDueTasks' | 'completeTask' | 'failTask'
  >;
  recovery: { recordFailure(input: CreateRecoveryInput): Promise<{ id: string }> };
  submissions: { markProcessing(id: string, status: 'failed', errorMessage?: string): Promise<void> };
}

export type TaskExecutors = Partial<Record<SubmissionTaskKind, (task: SubmissionTask) => Promise<void>>>;

export interface SweepOptions {
  /** Identifica a este barrido en los arriendos y reclamos. */
  owner: string;
  now: Date;
  /** Lista lo que haría sin arrendar, escribir casos ni tocar la cola. */
  dryRun?: boolean;
  /** Ejecutores de tareas diferidas. Sin ellos la cola no se reclama (reclamar sin ejecutar gastaría intentos). */
  executors?: TaskExecutors;
}

export interface SweepSummary {
  abandoned: AbandonedSubmission[];
  dueTasks: number;
  errors: string[];
}

const ABANDONED_MESSAGE =
  'El procesamiento de la preinscripción se interrumpió antes de terminar. Revisá Drive y la planilla antes de reintentar.';

/**
 * Un barrido: rescata envíos abandonados (lease vencido) dejando un caso de recuperación visible, y ejecuta las
 * tareas diferidas vencidas de la cola durable. Es el mismo código que usa el worker y `sweep:once`.
 */
export async function sweepOnce(deps: SweepDependencies, options: SweepOptions): Promise<SweepSummary> {
  const summary: SweepSummary = { abandoned: [], dueTasks: 0, errors: [] };

  if (options.dryRun) {
    summary.abandoned = await deps.processing.listAbandoned(options.now, BATCH);
    return summary;
  }

  summary.abandoned = await deps.processing.claimAbandoned(options.owner, options.now, BATCH, LEASE_TTL_MS);
  for (const item of summary.abandoned) {
    try {
      await deps.recovery.recordFailure({
        submissionId: item.submissionId,
        targetId: item.targetId,
        stage: 'unknown',
        safeError: item.legacy
          ? `${ABANDONED_MESSAGE} (envío anterior al protocolo: su resultado es incierto)`
          : ABANDONED_MESSAGE,
        retentionDays: 7,
        now: options.now,
      });
      await deps.submissions.markProcessing(item.submissionId, 'failed', ABANDONED_MESSAGE);
    } catch (error) {
      summary.errors.push(`${item.submissionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (options.executors && Object.keys(options.executors).length > 0) {
    const tasks = await deps.processing.claimDueTasks(options.owner, options.now, BATCH, TASK_CLAIM_TTL_MS);
    for (const task of tasks) {
      summary.dueTasks++;
      try {
        const executor = options.executors[task.kind];
        if (!executor) throw new Error(`Sin ejecutor para la tarea ${task.kind}`);
        await executor(task);
        await deps.processing.completeTask(task.id, options.owner);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push(`tarea ${task.id}: ${message}`);
        try {
          const outcome = await deps.processing.failTask(task.id, options.owner, message, options.now);
          if (outcome === 'gave_up') {
            await deps.recovery.recordFailure({
              submissionId: task.submissionId,
              targetId: '',
              stage: 'task_failed',
              safeError: `La tarea diferida ${task.kind} agotó sus intentos. Requiere revisión manual.`,
              retentionDays: 7,
              now: options.now,
            });
          }
        } catch (inner) {
          summary.errors.push(`tarea ${task.id} (al reprogramar): ${inner instanceof Error ? inner.message : String(inner)}`);
        }
      }
    }
  }

  return summary;
}
