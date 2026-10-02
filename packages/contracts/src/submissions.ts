export type SubmissionValues = Record<string, string>;

export interface CreateSubmissionPayload {
  configRevision: string;
  values: SubmissionValues;
}

export interface ValidationResult {
  valid: boolean;
  fieldErrors: Record<string, string[]>;
}

export interface SubmissionConfirmation {
  submissionId: string;
}
