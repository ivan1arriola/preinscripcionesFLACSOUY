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

export interface DatabaseSchema {
  targets: TargetsTable;
  input_definitions: InputDefinitionsTable;
  target_inputs: TargetInputsTable;
  orientations: OrientationsTable;
  mentions: MentionsTable;
  orientation_mentions: OrientationMentionsTable;
  submissions: SubmissionsTable;
  submission_values: SubmissionValuesTable;
}
