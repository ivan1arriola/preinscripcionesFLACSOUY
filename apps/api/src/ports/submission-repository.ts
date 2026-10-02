import type { SubmissionFileToken } from '@flacso/contracts';

export interface ValidatedSubmissionRecord {
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
}

export interface SubmissionRepository {
  save(submission: ValidatedSubmissionRecord): Promise<SavedSubmissionResult>;
}
