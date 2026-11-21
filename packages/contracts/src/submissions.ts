export type SubmissionValues = Record<string, string>;

export interface SubmissionFileToken {
  token: string;
  fieldKey: string;
  originalName: string;
  size: number;
  mimeType: string;
}

export interface CreateSubmissionPayload {
  configRevision: string;
  values: SubmissionValues;
  files?: SubmissionFileToken[];
}

export interface ValidationResult {
  valid: boolean;
  fieldErrors: Record<string, string[]>;
}

export interface SubmissionConfirmation {
  submissionId: string;
  offerCode?: string;
}
