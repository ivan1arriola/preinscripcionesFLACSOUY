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
  profile_version_id: string | null;
  profile_snapshot: unknown | null;
}

export interface SubmissionProcessingTable {
  submission_id: string;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  error_message: string | null;
  updated_at: Generated<Date>;
}

export interface SubmissionFilesTable {
  token: string;
  submission_id: string;
  field_key: string;
  original_name: string;
  mime_type: string;
  size: number;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  drive_file_id: string | null;
  error_message: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
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

export interface AdminUsersTable {
  id: string;
  google_subject: string;
  email: string;
  name: string;
  picture_url: string | null;
  role: string;
  created_at: Generated<Date>;
  last_login_at: Date | null;
}

export interface FormProfilesTable {
  id: string;
  type: string;
  name: string;
  active_version_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FormProfileVersionsTable {
  id: string;
  profile_id: string;
  version_number: number;
  definition: unknown;
  created_by: string;
  created_at: Generated<Date>;
}

export interface FormProfileAuditEventsTable {
  id: string;
  profile_id: string;
  version_id: string | null;
  action: string;
  actor_email: string;
  details: unknown | null;
  created_at: Generated<Date>;
}

export interface AdminSessionsTable {
  id: string;
  user_id: string;
  email: string;
  user_data: unknown;
  csrf_token: string;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface TemporaryUploadsTable {
  token: string;
  session_id: string;
  target_id: string | null;
  field_key: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: Generated<Date>;
  last_activity_at: Generated<Date>;
  expires_at: Date;
}

export interface DatabaseSchema {
  targets: TargetsTable;
  input_definitions: InputDefinitionsTable;
  target_inputs: TargetInputsTable;
  orientations: OrientationsTable;
  mentions: MentionsTable;
  orientation_mentions: OrientationMentionsTable;
  submissions: SubmissionsTable;
  submission_processing: SubmissionProcessingTable;
  submission_files: SubmissionFilesTable;
  submission_values: SubmissionValuesTable;
  technical_cache: TechnicalCacheTable;
  target_spreadsheets: TargetSpreadsheetsTable;
  spreadsheet_operations: SpreadsheetOperationsTable;
  admin_users: AdminUsersTable;
  admin_sessions: AdminSessionsTable;
  temporary_uploads: TemporaryUploadsTable;
  form_profiles: FormProfilesTable;
  form_profile_versions: FormProfileVersionsTable;
  form_profile_audit_events: FormProfileAuditEventsTable;
}
