import type { Generated } from 'kysely';

export interface TargetsTable {
  id: string;
  kind: string;
  title: string;
  config_revision: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InputDefinitionsTable {
  key: string;
  label: string;
  type: string;
  required_by_default: boolean;
  spreadsheet_column: string;
  created_at: Generated<Date>;
}

export interface TargetInputsTable {
  target_id: string;
  input_key: string;
  position: number;
  required: boolean;
}

export interface OrientationsTable {
  id: string;
  target_id: string;
  name: string;
}

export interface MentionsTable {
  id: string;
  name: string;
}

export interface OrientationMentionsTable {
  orientation_id: string;
  mention_id: string;
}

export interface SubmissionsTable {
  id: string;
  target_id: string;
  config_revision: string;
  submitted_at: Generated<Date>;
}

export interface SubmissionValuesTable {
  submission_id: string;
  input_key: string;
  value: string;
}

export interface TechnicalCacheTable {
  key: string;
  payload: string;
  cached_at: Generated<Date>;
  expires_at: Date;
}

export interface TargetSpreadsheetsTable {
  target_id: string;
  spreadsheet_id: string;
  sheet_name: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SpreadsheetOperationsTable {
  id: string;
  submission_id: string;
  target_id: string;
  spreadsheet_id: string;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  error_message: string | null;
  updated_range: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UploadSessionsTable {
  id: string;
  created_at: Generated<Date>;
  last_activity_at: Generated<Date>;
}

export interface UploadSessionFilesTable {
  id: string;
  session_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_at: Generated<Date>;
}

export interface SystemErrorsTable {
  id: string;
  severity: string;
  origin: string;
  code: string;
  message: string;
  context: any;
  target_id: string | null;
  status: string;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DatabaseSchema {
  targets: TargetsTable;
  input_definitions: InputDefinitionsTable;
  target_inputs: TargetInputsTable;
  orientations: OrientationsTable;
  mentions: MentionsTable;
  orientation_mentions: OrientationMentionsTable;
  submissions: SubmissionsTable;
  submission_values: SubmissionValuesTable;
  technical_cache: TechnicalCacheTable;
  target_spreadsheets: TargetSpreadsheetsTable;
  spreadsheet_operations: SpreadsheetOperationsTable;
  upload_sessions: UploadSessionsTable;
  upload_session_files: UploadSessionFilesTable;
  system_errors: SystemErrorsTable;
}


