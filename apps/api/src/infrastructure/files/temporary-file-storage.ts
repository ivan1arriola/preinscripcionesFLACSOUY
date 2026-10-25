import crypto from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  FileUpload,
  SaveFileMetadata,
  TemporaryFileRecord,
  TemporaryFileStoragePort,
} from '../../ports/file-storage.js';
import type { TemporaryUploadRepository } from '../../ports/temporary-upload-repository.js';

interface TemporaryFileStorageOptions {
  rootDir: string;
  maxBytes: number;
  allowedMimeTypes: string[];
  ttlMs?: number;
  repository?: TemporaryUploadRepository;
}

export class TemporaryFileStorage implements TemporaryFileStoragePort {
  private readonly ttlMs: number;
  private readonly repository?: TemporaryUploadRepository;

  constructor(private readonly options: TemporaryFileStorageOptions) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.repository = options.repository;
  }

  async save(
    sessionId: string,
    fieldKey: string,
    upload: FileUpload,
    meta?: SaveFileMetadata
  ): Promise<TemporaryFileRecord> {
    if (!this.options.allowedMimeTypes.includes(upload.mimeType)) {
      throw new Error(`El tipo de archivo no está permitido: ${upload.mimeType}`);
    }
    if (upload.data.byteLength > this.options.maxBytes) {
      throw new Error(`El tamaño del archivo supera el máximo de ${this.options.maxBytes} bytes`);
    }

    const token = crypto.randomBytes(16).toString('hex');
    const directory = join(this.options.rootDir, token);
    const createdAt = new Date();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, 'payload'), upload.data, { mode: 0o600 });
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await writeFile(
      join(directory, 'metadata.json'),
      JSON.stringify({
        sessionId,
        fieldKey,
        targetId: meta?.targetId,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        size: upload.data.byteLength,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }),
      { mode: 0o600 }
    );
    await chmod(directory, 0o700);

    if (this.repository) {
      await this.repository.create({
        token,
        sessionId,
        targetId: meta?.targetId,
        fieldKey,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        size: upload.data.byteLength,
        expiresAt,
      });
      await this.repository.touch(sessionId);
    }

    return {
      token,
      sessionId,
      targetId: meta?.targetId,
      fieldKey,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      size: upload.data.byteLength,
      createdAt,
    };
  }

  async open(token: string, sessionId?: string): Promise<FileUpload & { createdAt: Date }> {
    if (this.repository) {
      const record = await this.repository.get(token, sessionId);
      if (!record) {
        throw new Error('Acceso no autorizado al archivo temporal');
      }
      return {
        originalName: record.originalName,
        mimeType: record.mimeType,
        data: await readFile(join(this.directory(token), 'payload')),
        createdAt: record.createdAt,
      };
    }

    const directory = this.directory(token);
    const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')) as {
      sessionId: string;
      originalName: string;
      mimeType: string;
      createdAt: string;
    };
    // Sin sessionId la apertura es administrativa (reintento de recuperación), igual que en la
    // variante con repositorio: sólo se exige coincidencia cuando el postulante presenta su sesión.
    if (sessionId !== undefined && metadata.sessionId !== sessionId) {
      throw new Error('Acceso no autorizado al archivo temporal');
    }
    return {
      originalName: metadata.originalName,
      mimeType: metadata.mimeType,
      data: await readFile(join(directory, 'payload')),
      createdAt: new Date(metadata.createdAt),
    };
  }

  async remove(token: string, sessionId?: string): Promise<void> {
    if (this.repository) {
      if (sessionId) {
        const record = await this.repository.get(token, sessionId);
        if (!record) {
          throw new Error('Acceso no autorizado al archivo temporal');
        }
      }
      await this.repository.remove(token, sessionId);
      await rm(this.directory(token), { recursive: true, force: true });
      return;
    }

    if (sessionId) {
      await this.open(token, sessionId);
    }
    await rm(this.directory(token), { recursive: true, force: true });
  }

  async listBySession(sessionId: string): Promise<TemporaryFileRecord[]> {
    if (this.repository) {
      return this.repository.listBySession(sessionId);
    }

    const results: TemporaryFileRecord[] = [];
    let entries: string[] = [];
    try {
      entries = await readdir(this.options.rootDir);
    } catch {
      return [];
    }
    for (const token of entries) {
      try {
        const metadata = JSON.parse(
          await readFile(join(this.options.rootDir, token, 'metadata.json'), 'utf8')
        );
        if (metadata.sessionId === sessionId) {
          results.push({
            token,
            sessionId: metadata.sessionId,
            targetId: metadata.targetId,
            fieldKey: metadata.fieldKey,
            originalName: metadata.originalName,
            mimeType: metadata.mimeType,
            size: metadata.size,
            createdAt: new Date(metadata.createdAt),
          });
        }
      } catch {}
    }
    return results;
  }

  async touch(sessionId: string): Promise<void> {
    if (this.repository) {
      await this.repository.touch(sessionId);
    }
  }

  async extendRetention(tokens: string | string[], newExpiresAt: Date): Promise<void> {
    const tokenList = Array.isArray(tokens) ? tokens : [tokens];
    for (const token of tokenList) {
      if (this.repository && this.repository.extendExpiry) {
        await this.repository.extendExpiry(token, newExpiresAt);
      }
      try {
        const metadataPath = join(this.directory(token), 'metadata.json');
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
        metadata.expiresAt = newExpiresAt.toISOString();
        await writeFile(metadataPath, JSON.stringify(metadata), { mode: 0o600 });
      } catch {}
    }
  }

  async cleanup(before: number): Promise<number> {
    if (this.repository) {
      const expired = await this.repository.listExpired(new Date(before));
      let removed = 0;
      for (const record of expired) {
        try {
          await rm(this.directory(record.token), { recursive: true, force: true });
          await this.repository.deleteMetadata(record.token);
          removed++;
        } catch {}
      }
      return removed;
    }

    let removed = 0;
    let entries: string[] = [];
    try {
      entries = await readdir(this.options.rootDir);
    } catch {
      return 0;
    }
    for (const token of entries) {
      try {
        const metadata = JSON.parse(
          await readFile(join(this.options.rootDir, token, 'metadata.json'), 'utf8')
        ) as { createdAt: string; expiresAt?: string };
        const createdAt = new Date(metadata.createdAt).getTime();
        const expiresAt = metadata.expiresAt
          ? new Date(metadata.expiresAt).getTime()
          : createdAt + this.ttlMs;
        if (expiresAt < before) {
          await rm(join(this.options.rootDir, token), { recursive: true, force: true });
          removed++;
        }
      } catch {}
    }
    return removed;
  }

  private directory(token: string): string {
    if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Token de archivo inválido');
    return join(this.options.rootDir, token);
  }
}
