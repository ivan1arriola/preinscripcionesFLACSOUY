export type RecoveryStage =
  | 'drive'
  | 'sheets'
  | 'notifications'
  | 'unknown'
  /** Una escritura de Sheets aparece más de una vez: se resuelve a mano. */
  | 'sheets_duplicate'
  /** Archivos de un envío que ya no existen y deben volver a cargarse. */
  | 'files_missing'
  /** Una tarea diferida agotó sus intentos. */
  | 'task_failed';
export type RecoveryStatus = 'pending' | 'retrying' | 'resolved' | 'discarded';

export interface RecoveryFileSummary {
  token: string;
  fieldKey: string;
  originalName: string;
  size: number;
  mimeType: string;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  driveFileId?: string | null;
  errorMessage?: string | null;
}

export interface SubmissionRecoveryRecord {
  id: string;
  submissionId: string;
  targetId: string;
  stage: RecoveryStage;
  status: RecoveryStatus;
  safeError: string;
  attemptCount: number;
  firstFailedAt: Date;
  lastAttemptAt: Date;
  retentionExpiresAt: Date;
  lockedUntil?: Date | null;
  lockedBy?: string | null;
  discardedAt?: Date | null;
  discardedBy?: string | null;
  discardReason?: string | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  files?: RecoveryFileSummary[];
  values?: Record<string, string>;
  spreadsheetUrl?: string | null;
  documentsFolderUrl?: string | null;
  targetTitle?: string;
  targetKind?: string;
}

export interface CreateRecoveryInput {
  submissionId: string;
  targetId: string;
  stage: RecoveryStage;
  safeError: string;
  now?: Date;
  retentionDays?: number;
  spreadsheetUrl?: string;
  documentsFolderUrl?: string;
}

export interface SubmissionRecoveryFilter {
  status?: RecoveryStatus | RecoveryStatus[];
  stage?: RecoveryStage;
  targetId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface RetryResultInput {
  success: boolean;
  stage?: RecoveryStage;
  spreadsheetUrl?: string;
  documentsFolderUrl?: string;
  safeError?: string;
  now?: Date;
}

export interface SubmissionRecoveryRepository {
  recordFailure(input: CreateRecoveryInput): Promise<SubmissionRecoveryRecord>;
  listFailed(filter?: SubmissionRecoveryFilter): Promise<SubmissionRecoveryRecord[]>;
  findById(idOrSubmissionId: string): Promise<SubmissionRecoveryRecord | null>;
  claim(id: string, now: Date, leaseDurationMs?: number, lockedBy?: string): Promise<SubmissionRecoveryRecord | null>;
  release(id: string): Promise<void>;
  markRetryResult(id: string, result: RetryResultInput): Promise<void>;
  discard(id: string, discardedBy: string, reason?: string, now?: Date): Promise<void>;
  deleteExpired(now: Date): Promise<string[]>;
}
