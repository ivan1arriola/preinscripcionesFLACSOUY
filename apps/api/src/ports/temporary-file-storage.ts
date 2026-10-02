import type { UploadSession, UploadedFileInfo } from '../domain/upload-session.js';

export interface TemporaryFileStorage {
  createSession(): Promise<UploadSession>;
  getSession(sessionId: string): Promise<UploadSession | null>;
  storeFile(
    sessionId: string,
    file: { originalName: string; mimeType: string; buffer: Buffer }
  ): Promise<UploadedFileInfo>;
  getFile(
    sessionId: string,
    fileId: string
  ): Promise<{ info: UploadedFileInfo; buffer: Buffer } | null>;
  deleteFile(sessionId: string, fileId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  cleanupExpiredSessions(now: Date): Promise<number>;
}
