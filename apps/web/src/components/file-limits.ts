import type { DocumentDefinition } from '@flacso/contracts';

export interface FileLimitInfo {
  max: number;
  /** El campo admite más de un archivo. */
  multi: boolean;
  /** Ya se cargó el máximo: no se pueden agregar más hasta quitar alguno. */
  full: boolean;
}

/** Cuántos archivos admite un documento y si ya se llegó al máximo. */
export function fileLimitInfo(document: Pick<DocumentDefinition, 'maxFiles'>, count: number): FileLimitInfo {
  const max = Math.max(1, document.maxFiles ?? 1);
  return { max, multi: max > 1, full: count >= max };
}
