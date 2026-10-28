/**
 * Copias locales de los archivos que la persona eligió, solo para mostrarle una vista previa.
 * Viven en el navegador (URL de objeto): no se suben ni se guardan en ningún servidor, y se
 * liberan al quitar el archivo.
 */
export interface FilePreviewEntry {
  url: string;
  mimeType: string;
  name: string;
}

const previews = new Map<string, FilePreviewEntry>();

const canCreateUrls = () => typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

export function rememberPreview(token: string, file: File): void {
  forgetPreview(token);
  if (!canCreateUrls()) return;
  previews.set(token, { url: URL.createObjectURL(file), mimeType: file.type, name: file.name });
}

export function getPreview(token: string): FilePreviewEntry | undefined {
  return previews.get(token);
}

export function forgetPreview(token: string): void {
  const entry = previews.get(token);
  if (!entry) return;
  previews.delete(token);
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(entry.url);
}

export function previewKind(mimeType: string, name = ''): 'image' | 'pdf' | 'other' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'other';
}
