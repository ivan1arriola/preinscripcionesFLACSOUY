import type { AcademicTarget } from '@flacso/contracts';

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

const DOCUMENT_LABELS: Record<string, string> = {
  identidad: 'identidad',
  cv: 'cv',
  titulo: 'titulo',
  cartaMotivacion: 'carta-motivacion',
  cartaRecomendacion1: 'carta-recomendacion-1',
  cartaRecomendacion2: 'carta-recomendacion-2',
};

export function sanitizeDriveSegment(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

const displayValue = (value: string | number | undefined, fallback: string): string => {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || fallback;
};

export function buildDriveFolderNames(target: DriveTargetDescriptor): string[] {
  if (target.kind === 'seminar') {
    return [
      'Seminarios',
      displayValue(target.seminarName, 'Seminario'),
      target.editionName?.trim() || `Edición ${displayValue(target.editionNumber, 'sin número')}`,
    ];
  }

  return [
    'Ofertas académicas',
    displayValue(target.offerName, 'Oferta académica'),
    target.cohortName?.trim() || `Cohorte ${displayValue(target.cohortNumber, 'sin número')}`,
  ];
}

export function buildSemanticDriveFileName(input: {
  submissionId: string;
  fieldKey: string;
  originalName: string;
  mimeType: string;
  values: Record<string, string>;
  ordinal: number;
}): string {
  const surname = [input.values.apellido1, input.values.apellido2]
    .map((value) => sanitizeDriveSegment(value ?? ''))
    .filter(Boolean)
    .join('-') || 'postulante';
  const givenName = [input.values.nombre1, input.values.nombre2]
    .map((value) => sanitizeDriveSegment(value ?? ''))
    .filter(Boolean)
    .join('-') || 'sin-nombre';
  const documentLabel = DOCUMENT_LABELS[input.fieldKey] ?? (sanitizeDriveSegment(input.fieldKey) || 'documento');
  const originalExtension = input.originalName.match(/\.([A-Za-z0-9]{1,10})$/)?.[1]?.toLowerCase();
  const mimeExtension: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const extension = originalExtension || mimeExtension[input.mimeType] || 'bin';
  const ordinalSuffix = input.ordinal > 1 ? `-${input.ordinal}` : '';

  return `apellidos-${surname}__nombres-${givenName}__${documentLabel}__${sanitizeDriveSegment(input.submissionId)}${ordinalSuffix}.${extension}`;
}

export function buildSubmissionFolderName(input: {
  submissionId: string;
  values: Record<string, string>;
}): string {
  const surname = [input.values.apellido1, input.values.apellido2]
    .map((value) => sanitizeDriveSegment(value ?? ''))
    .filter(Boolean)
    .join('-') || 'postulante';
  const givenName = [input.values.nombre1, input.values.nombre2]
    .map((value) => sanitizeDriveSegment(value ?? ''))
    .filter(Boolean)
    .join('-') || 'sin-nombre';

  return `apellidos-${surname}__nombres-${givenName}__${sanitizeDriveSegment(input.submissionId)}`;
}

export function driveTargetDescriptor(target: AcademicTarget): DriveTargetDescriptor {
  const cohort = (target as AcademicTarget & { cohort?: { number?: number | string; name?: string } }).cohort;
  const edition = (target as AcademicTarget & { edition?: { number?: number | string; name?: string } }).edition;

  return target.kind === 'seminar'
    ? {
        targetId: target.id,
        kind: target.kind,
        seminarName: target.seminar?.name ?? target.title,
        editionName: edition?.name,
        editionNumber: edition?.number,
      }
    : {
        targetId: target.id,
        kind: target.kind,
        offerName: target.offer?.name ?? target.title,
        cohortName: cohort?.name,
        cohortNumber: cohort?.number,
      };
}
