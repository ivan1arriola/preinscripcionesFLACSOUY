import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { TemporaryFileStorage } from '../../ports/temporary-file-storage.js';
import {
  isSessionExpired,
  validateFileUpload,
  type UploadSession,
  type UploadedFileInfo,
} from '../../domain/upload-session.js';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/schema.js';

export interface FilesystemStorageOptions {
  baseDir: string;
  db?: Kysely<DatabaseSchema>;
}

export class FilesystemTemporaryStorage implements TemporaryFileStorage {
  private readonly baseDir: string;
  private readonly db?: Kysely<DatabaseSchema>;
  private memorySessions = new Map<string, UploadSession>();

  constructor(options: FilesystemStorageOptions) {
    this.baseDir = options.baseDir;
    this.db = options.db;
  }

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch {
      // already exists or created
    }
  }

  async createSession(): Promise<UploadSession> {
    const id = `sess_${crypto.randomUUID()}`;
    const now = new Date();
    const sessionDir = path.join(this.baseDir, id);
    await this.ensureDir(sessionDir);

    const session: UploadSession = {
      id,
      createdAt: now,
      lastActivityAt: now,
      files: [],
    };

    if (this.db) {
      try {
        await (this.db as any)
          .insertInto('upload_sessions')
          .values({
            id,
            created_at: now,
            last_activity_at: now,
          })
          .execute();
      } catch {
        // Fallback to memory
      }
    }
    this.memorySessions.set(id, session);

    return session;
  }

  async getSession(sessionId: string): Promise<UploadSession | null> {
    const session = this.memorySessions.get(sessionId);
    if (!session) return null;

    if (isSessionExpired(session, new Date())) {
      await this.deleteSession(sessionId);
      return null;
    }

    return session;
  }

  async storeFile(
    sessionId: string,
    file: { originalName: string; mimeType: string; buffer: Buffer }
  ): Promise<UploadedFileInfo> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Sesión de carga inexistente o expirada');
    }

    const validation = validateFileUpload({
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
    });
    if (!validation.valid) {
      throw new Error(validation.error || 'Archivo inválido');
    }

    const fileId = `file_${crypto.randomUUID()}`;
    const now = new Date();
    const filePath = path.join(this.baseDir, sessionId, fileId);

    await fs.writeFile(filePath, file.buffer);

    const fileInfo: UploadedFileInfo = {
      id: fileId,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
      uploadedAt: now,
    };

    session.files = [...session.files.filter((f) => f.id !== fileId), fileInfo];
    session.lastActivityAt = now;
    this.memorySessions.set(sessionId, session);

    if (this.db) {
      try {
        await (this.db as any)
          .updateTable('upload_sessions')
          .set({ last_activity_at: now })
          .where('id', '=', sessionId)
          .execute();

        await (this.db as any)
          .insertInto('upload_session_files')
          .values({
            id: fileId,
            session_id: sessionId,
            original_name: file.originalName,
            mime_type: file.mimeType,
            size_bytes: file.buffer.length,
            storage_path: filePath,
            uploaded_at: now,
          })
          .execute();
      } catch {
        // Fallback
      }
    }

    return fileInfo;
  }

  async getFile(
    sessionId: string,
    fileId: string
  ): Promise<{ info: UploadedFileInfo; buffer: Buffer } | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const fileInfo = session.files.find((f) => f.id === fileId);
    if (!fileInfo) return null;

    const filePath = path.join(this.baseDir, sessionId, fileId);
    try {
      const buffer = await fs.readFile(filePath);
      return { info: fileInfo, buffer };
    } catch {
      return null;
    }
  }

  async deleteFile(sessionId: string, fileId: string): Promise<void> {
    const session = this.memorySessions.get(sessionId);
    if (session) {
      session.files = session.files.filter((f) => f.id !== fileId);
      session.lastActivityAt = new Date();
    }

    const filePath = path.join(this.baseDir, sessionId, fileId);
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }

    if (this.db) {
      try {
        await (this.db as any)
          .deleteFrom('upload_session_files')
          .where('id', '=', fileId)
          .execute();
      } catch {
        // ignore
      }
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.memorySessions.delete(sessionId);
    const sessionDir = path.join(this.baseDir, sessionId);
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    if (this.db) {
      try {
        await (this.db as any)
          .deleteFrom('upload_sessions')
          .where('id', '=', sessionId)
          .execute();
      } catch {
        // ignore
      }
    }
  }

  async cleanupExpiredSessions(now: Date): Promise<number> {
    let count = 0;
    for (const [id, session] of this.memorySessions.entries()) {
      if (isSessionExpired(session, now)) {
        await this.deleteSession(id);
        count++;
      }
    }
    return count;
  }
}
