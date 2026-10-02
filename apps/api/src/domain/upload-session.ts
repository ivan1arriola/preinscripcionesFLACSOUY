export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

export interface UploadedFileInfo {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface UploadSession {
  id: string;
  createdAt: Date;
  lastActivityAt: Date;
  files: UploadedFileInfo[];
}

export function isSessionExpired(
  session: UploadSession,
  now: Date,
  ttlMs = SESSION_TTL_MS
): boolean {
  return now.getTime() - session.lastActivityAt.getTime() >= ttlMs;
}

export function validateFileUpload(file: {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}): { valid: boolean; error?: string } {
  if (file.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `El tamaño del archivo excede el máximo permitido de ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
    };
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimeType.toLowerCase())) {
    return {
      valid: false,
      error: 'El tipo de archivo no está permitido. Formatos aceptados: PDF, JPG, PNG.',
    };
  }

  return { valid: true };
}

export function touchSession(session: UploadSession, now: Date): UploadSession {
  return {
    ...session,
    lastActivityAt: now,
  };
}

export function addFileToSession(
  session: UploadSession,
  file: UploadedFileInfo,
  now: Date
): UploadSession {
  return {
    ...session,
    lastActivityAt: now,
    files: [...session.files.filter((f) => f.id !== file.id), file],
  };
}

export function removeFileFromSession(
  session: UploadSession,
  fileId: string,
  now: Date
): UploadSession {
  return {
    ...session,
    lastActivityAt: now,
    files: session.files.filter((f) => f.id !== fileId),
  };
}
