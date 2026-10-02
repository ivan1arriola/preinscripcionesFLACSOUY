import crypto from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileUpload, TemporaryFileRecord, TemporaryFileStoragePort } from '../../ports/file-storage.js';

interface TemporaryFileStorageOptions {
  rootDir: string;
  maxBytes: number;
  allowedMimeTypes: string[];
  ttlMs?: number;
}

export class TemporaryFileStorage implements TemporaryFileStoragePort {
  private readonly ttlMs: number;

  constructor(private readonly options: TemporaryFileStorageOptions) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  }

  async save(sessionId: string, fieldKey: string, upload: FileUpload): Promise<TemporaryFileRecord> {
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
    await writeFile(join(directory, 'metadata.json'), JSON.stringify({
      sessionId, fieldKey, originalName: upload.originalName, mimeType: upload.mimeType,
      size: upload.data.byteLength, createdAt: createdAt.toISOString(),
    }), { mode: 0o600 });
    await chmod(directory, 0o700);

    return { token, sessionId, fieldKey, originalName: upload.originalName, mimeType: upload.mimeType, size: upload.data.byteLength, createdAt };
  }

  async open(token: string, sessionId: string): Promise<FileUpload & { createdAt: Date }> {
    const directory = this.directory(token);
    const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')) as {
      sessionId: string; originalName: string; mimeType: string; createdAt: string;
    };
    if (metadata.sessionId !== sessionId) {
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
    if (sessionId) {
      await this.open(token, sessionId);
    }
    await rm(this.directory(token), { recursive: true, force: true });
  }

  async cleanup(before: number): Promise<number> {
    let removed = 0;
    let entries: string[] = [];
    try { entries = await readdir(this.options.rootDir); } catch { return 0; }
    for (const token of entries) {
      try {
        const metadata = JSON.parse(await readFile(join(this.options.rootDir, token, 'metadata.json'), 'utf8')) as { createdAt: string };
        const createdAt = new Date(metadata.createdAt).getTime();
        if (createdAt < before && Date.now() - createdAt >= this.ttlMs) {
          await rm(join(this.options.rootDir, token), { recursive: true, force: true });
          removed++;
        }
      } catch { /* Ignore malformed/partially written entries and leave them for inspection. */ }
    }
    return removed;
  }

  private directory(token: string): string {
    if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Token de archivo inválido');
    return join(this.options.rootDir, token);
  }
}
