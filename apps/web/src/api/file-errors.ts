import type { SubmissionFileToken } from '@flacso/contracts';
import { ApiError } from './client.js';

export const EXPIRED_FILE_MESSAGE = 'Este archivo venció y ya no está en el servidor. Volvé a cargarlo.';

/**
 * Campos de documentos cuyos archivos ya no existen en el servidor (la limpieza los borró por inactividad).
 * Vacío si el error es de otra clase.
 */
export function expiredFileFields(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'FILE_EXPIRED') return [];
  if (error.fields && error.fields.length > 0) return error.fields;
  return error.field ? [error.field] : [];
}

/** Quita de la pantalla los archivos que el servidor ya no tiene, para que no parezcan cargados. */
export function withoutExpiredFiles(files: SubmissionFileToken[], fields: string[]): SubmissionFileToken[] {
  if (fields.length === 0) return files;
  return files.filter((file) => !fields.includes(file.fieldKey));
}
