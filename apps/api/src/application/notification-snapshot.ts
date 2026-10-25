import type { AcademicTarget, FormDefinition } from '@flacso/contracts';

export type NotificationAudience = 'applicant' | 'target' | 'master';

export interface NotificationFieldValue {
  key: string;
  label: string;
  value: string;
}

export interface SubmissionNotificationSnapshot {
  submissionId: string;
  targetId: string;
  targetTitle: string;
  targetKind: 'academic_offer' | 'seminar';
  applicantEmail: string;
  applicantName?: string;
  /** Optional: snapshots persisted before multi-recipient support do not include it. */
  notificationEmails?: string[];
  values: Record<string, NotificationFieldValue>;
  orderedFieldKeys: string[];
  spreadsheetRowUrl: string;
  documentsFolderUrl: string;
  templateVersion: 'preinscription-notification-v1';
  /** Fecha en que se eliminaron los datos personales del postulante (política de retención). */
  redactedAt?: string;
}

/**
 * Quita del snapshot todo dato del postulante y los enlaces a su planilla y carpeta de Drive; conserva
 * lo necesario para auditar el envío (qué preinscripción, a qué destino y cuándo se redactó).
 */
export function redactNotificationSnapshot(
  snapshot: SubmissionNotificationSnapshot,
  redactedAt: Date = new Date(),
): SubmissionNotificationSnapshot {
  return {
    submissionId: snapshot.submissionId,
    targetId: snapshot.targetId,
    targetTitle: snapshot.targetTitle,
    targetKind: snapshot.targetKind,
    applicantEmail: '',
    values: {},
    orderedFieldKeys: [],
    spreadsheetRowUrl: '',
    documentsFolderUrl: '',
    templateVersion: snapshot.templateVersion,
    redactedAt: redactedAt.toISOString(),
  };
}

export interface FormFieldInfo {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
}

export interface BuildSnapshotParams {
  submissionId: string;
  target: AcademicTarget;
  fields?: FormFieldInfo[];
  formDefinition?: FormDefinition;
  payload: Record<string, unknown>;
  spreadsheetRowUrl: string;
  documentsFolderUrl: string;
}

export function buildSubmissionNotificationSnapshot(params: BuildSnapshotParams): SubmissionNotificationSnapshot {
  const { submissionId, target, fields: explicitFields, formDefinition, payload, spreadsheetRowUrl, documentsFolderUrl } = params;

  let fields: FormFieldInfo[] = [];

  if (explicitFields && explicitFields.length > 0) {
    fields = explicitFields;
  } else if (formDefinition) {
    const inputFields: FormFieldInfo[] = (formDefinition.inputs || []).map((input) => ({
      key: input.key,
      label: input.label,
      type: input.type,
      required: input.required,
    }));
    const docFields: FormFieldInfo[] = (formDefinition.documents || []).map((doc) => ({
      key: doc.key,
      label: doc.label,
      type: 'file',
      required: doc.required,
    }));
    fields = [...inputFields, ...docFields];
  }

  const values: Record<string, NotificationFieldValue> = {};
  const orderedFieldKeys: string[] = [];

  let applicantEmail = '';
  let firstName = '';
  let lastName = '';

  const knownKeys = new Set<string>();

  for (const field of fields) {
    orderedFieldKeys.push(field.key);
    knownKeys.add(field.key);

    const rawVal = payload[field.key];
    let displayVal = '';

    if (field.type === 'file') {
      if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
        displayVal = 'Archivo adjunto';
      } else {
        displayVal = '-';
      }
    } else if (rawVal === undefined || rawVal === null || rawVal === '') {
      displayVal = '-';
    } else if (typeof rawVal === 'boolean') {
      displayVal = rawVal ? 'Sí' : 'No';
    } else if (Array.isArray(rawVal)) {
      displayVal = rawVal.map((v) => String(v).trim()).filter(Boolean).join(', ') || '-';
    } else if (typeof rawVal === 'object') {
      if ('token' in (rawVal as Record<string, unknown>)) {
        displayVal = 'Archivo adjunto';
      } else {
        displayVal = JSON.stringify(rawVal);
      }
    } else {
      displayVal = String(rawVal).trim();
    }

    if (field.key === 'email' || field.type === 'email') {
      displayVal = displayVal.toLowerCase();
      applicantEmail = displayVal;
    }
    if (field.key === 'nombre' || field.key === 'nombre1') {
      firstName = displayVal;
    }
    if (field.key === 'apellido' || field.key === 'apellido1') {
      lastName = displayVal;
    }

    values[field.key] = {
      key: field.key,
      label: field.label,
      value: displayVal,
    };
  }

  // Include any extra payload fields not in known fields
  for (const [key, rawVal] of Object.entries(payload)) {
    if (knownKeys.has(key)) continue;
    if (key.startsWith('_')) continue; // Skip private metadata

    orderedFieldKeys.push(key);
    let displayVal = '';
    if (rawVal === undefined || rawVal === null || rawVal === '') {
      displayVal = '-';
    } else if (typeof rawVal === 'boolean') {
      displayVal = rawVal ? 'Sí' : 'No';
    } else if (Array.isArray(rawVal)) {
      displayVal = rawVal.map((v) => String(v).trim()).filter(Boolean).join(', ') || '-';
    } else if (typeof rawVal === 'object') {
      if ('token' in (rawVal as Record<string, unknown>)) {
        displayVal = 'Archivo adjunto';
      } else {
        displayVal = JSON.stringify(rawVal);
      }
    } else {
      displayVal = String(rawVal).trim();
    }

    if (key === 'email') {
      displayVal = displayVal.toLowerCase();
      applicantEmail = displayVal;
    }

    values[key] = {
      key,
      label: key,
      value: displayVal,
    };
  }

  if (!applicantEmail && typeof payload['email'] === 'string') {
    applicantEmail = payload['email'].trim().toLowerCase();
  }

  const applicantNameParts = [firstName, lastName].filter((s) => s && s !== '-');
  const applicantName = applicantNameParts.length > 0 ? applicantNameParts.join(' ') : undefined;

  const notificationEmails = [
    ...new Set(
      (target.notificationEmails ?? [])
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0)
    ),
  ];

  return {
    submissionId,
    targetId: target.id,
    targetTitle: target.title,
    targetKind: target.kind,
    applicantEmail,
    applicantName,
    notificationEmails,
    values,
    orderedFieldKeys,
    spreadsheetRowUrl,
    documentsFolderUrl,
    templateVersion: 'preinscription-notification-v1',
  };
}
