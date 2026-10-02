export interface ValidatedSubmissionRecord {
  targetId: string;
  configRevision: string;
  targetTitle: string;
  targetKind: string;
  values: Record<string, string>;
}

export interface SavedSubmissionResult {
  id: string;
}

export interface SubmissionRepository {
  save(submission: ValidatedSubmissionRecord): Promise<SavedSubmissionResult>;
}
