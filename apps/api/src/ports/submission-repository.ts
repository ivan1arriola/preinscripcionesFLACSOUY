import type { SubmissionFileToken } from '@flacso/contracts';

export interface ValidatedSubmissionRecord {
  clientSubmissionId?: string;
  targetId: string;
  configRevision: string;
  targetTitle: string;
  targetKind: string;
  values: Record<string, string>;
  files?: SubmissionFileToken[];
  profileVersionId?: string | null;
  profileSnapshot?: unknown | null;
}

export interface SavedSubmissionResult {
  id: string;
  existing: boolean;
}

export interface SubmissionRepository {
  save(submission: ValidatedSubmissionRecord): Promise<SavedSubmissionResult>;
  saveOrGet(submission: ValidatedSubmissionRecord): Promise<SavedSubmissionResult>;
  markProcessing(id: string, status: 'pending' | 'success' | 'failed' | 'unknown', errorMessage?: string): Promise<void>;
  markFileStored(token: string, driveFileId: string): Promise<void>;
  markFileFailed(token: string, errorMessage: string): Promise<void>;
}
