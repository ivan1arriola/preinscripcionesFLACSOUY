export interface DriveTargetDescriptor {
  targetId: string;
  kind: 'academic_offer' | 'seminar';
  offerName?: string;
  cohortName?: string;
  cohortNumber?: number | string;
  seminarName?: string;
  editionName?: string;
  editionNumber?: number | string;
}

export function sanitizeDriveSegment(value: string): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // replace non-alphanumeric with dash
    .replace(/^-+|-+$/g, ''); // remove leading and trailing dashes
}

export function buildDriveFolderNames(target: DriveTargetDescriptor): string[] {
  if (target.kind === 'academic_offer') {
    if (!target.offerName) throw new Error('Missing offerName for academic_offer');
    const cohort = target.cohortName ?? (target.cohortNumber ? `Cohorte ${target.cohortNumber}` : null);
    if (!cohort) throw new Error('Missing cohort information for academic_offer');
    return ['Ofertas académicas', target.offerName, cohort];
  } else if (target.kind === 'seminar') {
    if (!target.seminarName) throw new Error('Missing seminarName for seminar');
    const edition = target.editionName ?? (target.editionNumber ? `Edición ${target.editionNumber}` : null);
    if (!edition) throw new Error('Missing edition information for seminar');
    return ['Seminarios', target.seminarName, edition];
  }
  throw new Error(`Unknown target kind: ${(target as any).kind}`);
}

export interface SemanticDriveFileNameInput {
  submissionId: string;
  fieldKey: string;
  originalName: string;
  mimeType: string;
  values: Record<string, string>;
  ordinal: number;
}

function getExtensionFromMime(mimeType: string): string {
  const mapping: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return mapping[mimeType] ?? '';
}

export function buildSemanticDriveFileName(input: SemanticDriveFileNameInput): string {
  let ext = '';
  const lastDot = input.originalName.lastIndexOf('.');
  if (lastDot !== -1 && lastDot < input.originalName.length - 1) {
    ext = input.originalName.substring(lastDot).toLowerCase();
  } else {
    ext = getExtensionFromMime(input.mimeType);
  }

  const { values } = input;
  const surname1 = sanitizeDriveSegment(values.apellido1 ?? '');
  const surname2 = sanitizeDriveSegment(values.apellido2 ?? '');
  const name1 = sanitizeDriveSegment(values.nombre1 ?? '');
  const name2 = sanitizeDriveSegment(values.nombre2 ?? '');

  const surnames = [surname1, surname2].filter(Boolean).join('-');
  const names = [name1, name2].filter(Boolean).join('-');

  let identity = '';
  if (surnames || names) {
    const parts = [];
    if (surnames) parts.push(`apellidos-${surnames}`);
    if (names) parts.push(`nombres-${names}`);
    identity = parts.join('__');
  } else {
    identity = 'postulante';
  }

  const documentType = sanitizeDriveSegment(input.fieldKey);
  const docPart = input.ordinal > 0 ? `${documentType}-${input.ordinal + 1}` : documentType;

  return `${identity}__${docPart}__${input.submissionId}${ext}`;
}
