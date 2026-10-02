export type AcademicTargetKind = 'academic_offer' | 'seminar';
export type OfferType = 'maestria' | 'especializacion' | 'diplomado' | 'diploma' | 'seminar';

export interface FormStepDefinition {
  id: string;
  title: string;
  order: number;
  description?: string;
}

export interface DocumentDefinition {
  key: string;
  label: string;
  required: boolean;
  position?: number;
  stepId?: string;
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
  stepId?: string;
  placeholder?: string;
  helpText?: string;
  spreadsheetColumn?: string;
  optionsSource?: 'wordpress.orientaciones' | 'wordpress.menciones';
  condition?: 'always' | 'has_orientations' | 'has_mentions';
}

export interface WordPressTargetOffer {
  id: number;
  slug: string;
  name: string;
  type: string;
  orientations?: string[];
  mentions?: string[];
}

export interface WordPressTargetSeminar {
  id: number;
  slug: string;
  name: string;
  type: 'seminar';
}

export type RegistrationAvailability = 'open' | 'closed' | 'conflict';

export interface AcademicTarget {
  id: string;
  kind: AcademicTargetKind;
  title: string;
  offerType?: string;
  registrationOpen: boolean;
  registrationAvailability?: RegistrationAvailability;
  registrationWindow?: RegistrationWindow;
  configRevision: string;
  wordpress?: {
    offerId?: number;
    cohortId?: number;
    seminarId?: number;
    editionId?: number;
  };
  offer?: WordPressTargetOffer;
  seminar?: WordPressTargetSeminar;
  orientations: string[];
  mentions: string[];
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
  offerType: string;
  profileVersionId: string;
  effectiveRevision: string;
  registrationOpen: boolean;
  configRevision: string;
  steps: FormStepDefinition[];
  inputs: InputDefinition[];
  documents: DocumentDefinition[];
  orientations: string[];
  mentions: string[];
  recommendationLettersCount?: number;
}

export type DiagnosticStatus = 'operational' | 'closed' | 'incompatible';

export interface DiagnosticTarget {
  id: string;
  kind: AcademicTargetKind;
  title: string;
  offerType?: string;
  registrationOpen: boolean;
  registrationAvailability?: RegistrationAvailability;
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
