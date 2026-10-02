export type AcademicTargetKind = 'academic_offer' | 'seminar';

export interface Mention {
  id: string;
  name: string;
}

export interface Orientation {
  id: string;
  name: string;
  mentions?: Mention[];
}

export interface DocumentDefinition {
  key: string;
  label: string;
  required: boolean;
  position?: number;
  maxFiles?: number;
  maxBytes?: number;
  acceptedMimeTypes?: string[];
  canDefer?: boolean;
}

export interface TargetDocumentConfig {
  key: string;
  required?: boolean;
  position?: number;
  maxFiles?: number;
  maxBytes?: number;
  acceptedMimeTypes?: string[];
  canDefer?: boolean;
}

export interface RegistrationWindow {
  from: string | null;
  until: string | null;
}

export type InputType = 'text' | 'email' | 'tel' | 'date' | 'select' | 'textarea' | 'checkbox';

export interface InputDefinition {
  key: string;
  label: string;
  type: InputType;
  required: boolean;
  position?: number;
  placeholder?: string;
  helpText?: string;
  spreadsheetColumn?: string;
  optionsSource?: 'wordpress.orientaciones' | 'wordpress.menciones';
}

export interface TargetInputConfig {
  key: string;
  position?: number;
  required?: boolean;
}

export interface AcademicTarget {
  id: string;
  kind: AcademicTargetKind;
  title: string;
  registrationOpen: boolean;
  registrationWindow?: RegistrationWindow;
  configRevision: string;
  form: {
    valid: boolean;
    inputs: TargetInputConfig[];
    documents?: TargetDocumentConfig[];
    issues: string[];
  };
  orientations: Orientation[];
  mentions?: Mention[];
  urls?: {
    public?: string;
    wordpress?: string;
    edit?: string;
    legacyRegistration?: string;
  };
}

export interface FormDefinition {
  targetId: string;
  kind: AcademicTargetKind;
  title: string;
  registrationOpen: boolean;
  configRevision: string;
  inputs: InputDefinition[];
  orientations: Orientation[];
  mentions?: Mention[];
  documents?: DocumentDefinition[];
}

export type DiagnosticStatus = 'operational' | 'closed' | 'incompatible';

export interface DiagnosticTarget {
  id: string;
  kind: AcademicTargetKind;
  title: string;
  registrationOpen: boolean;
  configRevision: string;
  status: DiagnosticStatus;
  issues: string[];
  urls?: {
    public?: string;
    wordpress?: string;
    edit?: string;
    legacyRegistration?: string;
  };
}
