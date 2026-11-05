export type SubmissionTaskKind = 'sheets_reconcile' | 'sheets_recount';

export interface SubmissionTask {
  id: string;
  submissionId: string;
  kind: SubmissionTaskKind;
  runAt: Date;
  attempts: number;
}

export interface AbandonedSubmission {
  submissionId: string;
  targetId: string;
  /** true si la fila nació antes del protocolo (sin lease): su resultado es incierto. */
  legacy: boolean;
}

/** Máximo de intentos de una tarea antes de dejar un caso visible. */
export const MAX_TASK_ATTEMPTS = 5;

/**
 * Lease del procesador de cada envío y cola durable de tareas diferidas.
 * Todas las operaciones son atómicas en la base: ninguna comprueba y luego actúa.
 */
export interface SubmissionProcessingRepository {
  /** Renueva el lease solo si `owner` sigue siendo el dueño. */
  renewLease(submissionId: string, owner: string, now: Date, ttlMs: number): Promise<boolean>;
  /** Libera el lease solo si `owner` sigue siendo el dueño. */
  releaseLease(submissionId: string, owner: string): Promise<boolean>;
  /**
   * Reclama (y arrienda a `owner`) envíos pendientes cuyo lease venció, sin caso de recuperación activo y sin
   * espera programada. Dos barridos simultáneos nunca reciben el mismo envío.
   */
  claimAbandoned(owner: string, now: Date, limit: number, leaseTtlMs: number): Promise<AbandonedSubmission[]>;
  /** Igual que claimAbandoned pero de solo lectura: no arrienda ni modifica nada (para `sweep:once --dry-run`). */
  listAbandoned(now: Date, limit: number): Promise<AbandonedSubmission[]>;
  /** Encola una tarea; encolar la misma (envío, tipo, momento) dos veces es inocuo. */
  enqueueTask(task: { submissionId: string; kind: SubmissionTaskKind; runAt: Date }): Promise<void>;
  /**
   * Reclama tareas vencidas sin importar el estado del envío ni si tiene un caso activo. Una tarea reclamada por un
   * proceso que cae se reabre sola al vencer el reclamo.
   */
  claimDueTasks(owner: string, now: Date, limit: number, claimTtlMs: number): Promise<SubmissionTask[]>;
  completeTask(taskId: string, owner: string): Promise<boolean>;
  /** Reprograma con retroceso exponencial; tras MAX_TASK_ATTEMPTS la da por perdida para que el llamador cree un caso. */
  failTask(taskId: string, owner: string, error: string, now: Date): Promise<'rescheduled' | 'gave_up'>;
}
