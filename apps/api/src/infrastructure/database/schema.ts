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
  client_submission_id?: string | null;
  target_id: string;
  config_revision: string;
  submitted_at: Generated<Date>;
  profile_version_id: string | null;
  profile_snapshot: unknown | null;
  catalog_validation: Generated<'live' | 'cached'>;
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
  root_folder_id: string | null;
  status: string | null;
  last_discovered_at: Date | null;
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

export interface EmailNotificationsTable {
  id: string;
  submission_id: string;
  audience: 'applicant' | 'target' | 'master';
  recipient_email: string;
  target_id: string;
  template_version: string;
  payload_json: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'unknown';
  attempt_count: number;
  provider_message_id: string | null;
  last_error: string | null;
  available_at: Date;
  locked_until: Date | null;
  sent_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SubmissionRecoveriesTable {
  id: string;
  submission_id: string;
  target_id: string;
  stage: 'drive' | 'sheets' | 'notifications' | 'unknown';
  status: 'pending' | 'retrying' | 'resolved' | 'discarded';
  safe_error: string;
  attempt_count: number;
  first_failed_at: Generated<Date>;
  last_attempt_at: Generated<Date>;
  retention_expires_at: Date;
  locked_until: Date | null;
  locked_by: string | null;
  discarded_at: Date | null;
  discarded_by: string | null;
  discard_reason: string | null;
  resolved_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TelegramRecoveryAlertsTable {
  id: string;
  recovery_id: string | null;
  submission_id: string;
  chat_id: string;
  event_type: Generated<'recovery' | 'preinscription'>;
  dedupe_key: string;
  message: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  attempt_count: Generated<number>;
  max_attempts: Generated<number>;
  available_at: Generated<Date>;
  locked_until: Date | null;
  locked_by: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  sent_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MauticContactSyncTable {
  id: string;
  submission_id: string;
  payload_json: string;
  status: 'pending' | 'processing' | 'synced' | 'failed';
  attempt_count: number;
  available_at: Date;
  locked_until: Date | null;
  locked_by: string | null;
  last_error: string | null;
  mautic_contact_id: number | null;
  synced_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MauticEnrollmentNotifyTable {
  /** eventId del aviso: Mautic lo usa para la idempotencia. */
  id: string;
  submission_id: string;
  payload_json: string;
  status: 'pending' | 'processing' | 'notified' | 'failed';
  attempt_count: number;
  available_at: Date;
  locked_until: Date | null;
  locked_by: string | null;
  last_error: string | null;
  notified_at: Date | null;
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
  email_notifications: EmailNotificationsTable;
  submission_recoveries: SubmissionRecoveriesTable;
  telegram_recovery_alerts: TelegramRecoveryAlertsTable;
  mautic_contact_sync: MauticContactSyncTable;
  mautic_enrollment_notify: MauticEnrollmentNotifyTable;
}
