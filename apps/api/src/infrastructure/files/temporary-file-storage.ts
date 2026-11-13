import crypto from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  FileUpload,
  SaveFileMetadata,
  TemporaryFileRecord,
  TemporaryFileStoragePort,
} from '../../ports/file-storage.js';
import type { TemporaryUploadRepository } from '../../ports/temporary-upload-repository.js';

export type FileStorageErrorCode = 'FORBIDDEN' | 'FILE_EXPIRED' | 'FILE_ALREADY_SUBMITTED';

/** Error de dominio del almacenamiento: el código permite mapear a HTTP sin comparar mensajes. */
export class FileStorageError extends Error {
  constructor(readonly code: FileStorageErrorCode, message: string) {
    super(message);
    this.name = 'FileStorageError';
  }
}

const UNAUTHORIZED = 'Acceso no autorizado al archivo temporal';
const RETAINED_DIR = 'retained';
const DELETING_DIR = 'deleting';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

interface TemporaryFileStorageOptions {
  rootDir: string;
  maxBytes: number;
  allowedMimeTypes: string[];
  ttlMs?: number;
  repository?: TemporaryUploadRepository;
}

interface StoredMetadata {
  sessionId: string;
  fieldKey?: string;
  targetId?: string;
  originalName: string;
  mimeType: string;
  size?: number;
  createdAt: string;
  expiresAt?: string;
  pinnedAt?: string;
  pinnedFor?: string;
}

/**
 * Los archivos viven en tres sitios dentro de `rootDir`, todos en el mismo volumen:
 *   <root>/<token>/            subida reciente ("pendiente", vence por TTL)
 *   <root>/retained/<token>/   fijado por una preinscripción aceptada
 *   <root>/deleting/<token>/   reclamado para borrar (limpieza o borrado explícito)
 * Fijar y limpiar compiten con un `rename` del mismo origen: gana exactamente uno.
 */
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
        throw new Error(UNAUTHORIZED);
      }
      const located = await this.locate(token);
      if (!located) throw new FileStorageError('FILE_EXPIRED', 'El archivo temporal ya no está disponible.');
      return {
        originalName: record.originalName,
        mimeType: record.mimeType,
        data: await readFile(join(located.dir, 'payload')),
        createdAt: record.createdAt,
      };
    }

    const located = await this.locate(token);
    if (!located) throw new FileStorageError('FILE_EXPIRED', 'El archivo temporal ya no está disponible.');
    const { metadata } = located;
    // Sin sessionId la apertura es administrativa (reintento de recuperación), igual que en la
    // variante con repositorio: sólo se exige coincidencia cuando el postulante presenta su sesión.
    if (sessionId !== undefined && metadata.sessionId !== sessionId) {
      throw new Error(UNAUTHORIZED);
    }
    return {
      originalName: metadata.originalName,
      mimeType: metadata.mimeType,
      data: await readFile(join(located.dir, 'payload')),
      createdAt: new Date(metadata.createdAt),
    };
  }

  /**
   * Fija los archivos de un envío en `retained/`. Es reanudable e idempotente por token: un token que ya está
   * fijado por la misma sesión cuenta como éxito (reintento tras respuesta perdida, fijado parcial o caída).
   * Falla con FORBIDDEN (sesión ajena) o FILE_EXPIRED (ya no existe en ningún sitio) antes de guardar nada.
   */
  async pinFiles(tokens: string[], sessionId: string, clientSubmissionId: string): Promise<void> {
    for (const token of tokens) {
      this.assertToken(token);
      try {
        await this.pinOne(token, sessionId, clientSubmissionId);
      } catch (error) {
        if (error instanceof FileStorageError) throw error;
        // Una carrera con la limpieza puede dejar un error de sistema de archivos crudo (p. ej. EPERM en Windows).
        // Si el archivo ya no está en ningún sitio, el resultado es el mismo: venció.
        const stillThere = await this.locate(token).then((found) => found !== null, () => true);
        if (!stillThere) {
          throw new FileStorageError('FILE_EXPIRED', 'El archivo ya venció. Volvé a cargarlo.');
        }
        throw error;
      }
    }
  }

  private async pinOne(token: string, sessionId: string, clientSubmissionId: string): Promise<void> {
    {
      const pending = join(this.options.rootDir, token);
      const retained = join(this.options.rootDir, RETAINED_DIR, token);

      const pendingMeta = await this.readMetadata(pending);
      if (pendingMeta && pendingMeta.sessionId !== sessionId) {
        throw new FileStorageError('FORBIDDEN', UNAUTHORIZED);
      }

      let moved = false;
      if (pendingMeta) {
        await mkdir(join(this.options.rootDir, RETAINED_DIR), { recursive: true, mode: 0o700 });
        try {
          await renameWithRetry(pending, retained);
          moved = true;
        } catch (error) {
          if (!isFsError(error, ['ENOENT', 'EEXIST', 'ENOTEMPTY'])) throw error;
        }
      }

      const retainedMeta = await this.readMetadata(retained);
      if (!retainedMeta) {
        throw new FileStorageError('FILE_EXPIRED', 'El archivo ya venció. Volvé a cargarlo.');
      }
      if (retainedMeta.sessionId !== sessionId) {
        throw new FileStorageError('FORBIDDEN', UNAUTHORIZED);
      }

      const expiresAt = new Date(Date.now() + RETENTION_MS);
      if (moved || !retainedMeta.pinnedAt) {
        await this.writeMetadata(retained, {
          ...retainedMeta,
          pinnedAt: new Date().toISOString(),
          pinnedFor: clientSubmissionId,
          expiresAt: expiresAt.toISOString(),
        });
      }
      if (this.repository?.extendExpiry) {
        await this.repository.extendExpiry(token, expiresAt);
      }
    }
  }

  /**
   * Adopta archivos heredados a `retained/` sin comprobar sesión (uso administrativo en el arranque).
   * Rename atómico de `<root>/<token>` a `<root>/retained/<token>` si sigue pendiente.
   * Si ya está retenido cuenta como éxito. Devuelve la lista de tokens ausentes en ambos sitios.
   */
  async adoptFiles(tokens: string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const token of tokens) {
      this.assertToken(token);
      const pending = join(this.options.rootDir, token);
      const retained = join(this.options.rootDir, RETAINED_DIR, token);

      let moved = false;
      const pendingMeta = await this.readMetadata(pending);
      if (pendingMeta) {
        await mkdir(join(this.options.rootDir, RETAINED_DIR), { recursive: true, mode: 0o700 });
        try {
          await renameWithRetry(pending, retained);
          moved = true;
        } catch (error) {
          if (!isFsError(error, ['ENOENT', 'EEXIST', 'ENOTEMPTY'])) throw error;
        }
      }

      const retainedMeta = await this.readMetadata(retained);
      if (!retainedMeta) {
        missing.push(token);
        continue;
      }

      const expiresAt = new Date(Date.now() + RETENTION_MS);
      if (moved || !retainedMeta.pinnedAt) {
        await this.writeMetadata(retained, {
          ...retainedMeta,
          pinnedAt: retainedMeta.pinnedAt ?? new Date().toISOString(),
          pinnedFor: retainedMeta.pinnedFor ?? 'legacy-adoption',
          expiresAt: expiresAt.toISOString(),
        });
      }
      if (this.repository?.extendExpiry) {
        await this.repository.extendExpiry(token, expiresAt);
      }
    }

    return missing;
  }

  /**
   * Borrado público de un archivo pendiente (DELETE /uploads/:token). Nunca toca `retained/`: si el archivo
   * ya fue fijado por un envío responde FILE_ALREADY_SUBMITTED y lo deja intacto.
   */
  async removePending(token: string, sessionId: string): Promise<void> {
    this.assertToken(token);
    const pending = join(this.options.rootDir, token);
    const retained = join(this.options.rootDir, RETAINED_DIR, token);

    if (this.repository) {
      const record = await this.repository.get(token, sessionId);
      if (!record) throw new Error(UNAUTHORIZED);
    }

    const pendingMeta = await this.readMetadata(pending);
    if (pendingMeta) {
      if (pendingMeta.sessionId !== sessionId) throw new Error(UNAUTHORIZED);
      if (await this.claimForDeletion(pending, token)) {
        await this.repository?.remove(token, sessionId);
        return;
      }
    }

    // El origen ya no está: o lo fijó un envío, o desapareció.
    const retainedMeta = await this.readMetadata(retained);
    if (retainedMeta) {
      if (retainedMeta.sessionId !== sessionId) throw new Error(UNAUTHORIZED);
      throw new FileStorageError('FILE_ALREADY_SUBMITTED', 'El archivo ya forma parte de una preinscripción enviada.');
    }
    if (!this.repository && !pendingMeta) throw new Error(UNAUTHORIZED);
    await this.repository?.remove(token, sessionId);
  }

  /** Borrado interno de un archivo fijado. No se expone por HTTP; solo transiciones terminales controladas. */
  async releaseRetained(token: string): Promise<void> {
    this.assertToken(token);
    const claimed = await this.claimForDeletion(join(this.options.rootDir, RETAINED_DIR, token), token);
    if (claimed) await this.repository?.remove(token);
  }

  /**
   * Borrado interno de cualquier archivo (pendiente o fijado), sin comprobar sesión ni exponerse por HTTP.
   * Para el borrado iniciado por el postulante usar `removePending`.
   */
  async remove(token: string, sessionId?: string): Promise<void> {
    this.assertToken(token);
    if (sessionId) {
      if (this.repository) {
        const record = await this.repository.get(token, sessionId);
        if (!record) throw new Error(UNAUTHORIZED);
      } else {
        const located = await this.locate(token);
        if (!located || located.metadata.sessionId !== sessionId) throw new Error(UNAUTHORIZED);
      }
    }
    await this.claimForDeletion(join(this.options.rootDir, token), token);
    await this.claimForDeletion(join(this.options.rootDir, RETAINED_DIR, token), token);
    await this.repository?.remove(token, sessionId);
  }

  async listPendingBySession(sessionId: string): Promise<TemporaryFileRecord[]> {
    const records = await this.listBySession(sessionId);
    const pending: TemporaryFileRecord[] = [];
    for (const record of records) {
      // La base puede conservar metadatos de archivos vencidos o ya fijados.
      // Solo los archivos realmente pendientes consumen el cupo de carga.
      const metadata = await this.readMetadata(this.pendingDir(record.token));
      if (metadata && metadata.sessionId === sessionId) {
        pending.push(record);
      }
    }
    return pending;
  }

  async listBySession(sessionId: string): Promise<TemporaryFileRecord[]> {
    if (this.repository) {
      return this.repository.listBySession(sessionId);
    }

    const results: TemporaryFileRecord[] = [];
    for (const base of [this.options.rootDir, join(this.options.rootDir, RETAINED_DIR)]) {
      let entries: string[] = [];
      try {
        entries = await readdir(base);
      } catch {
        continue;
      }
      for (const token of entries) {
        if (!TOKEN_PATTERN.test(token)) continue;
        const metadata = await this.readMetadata(join(base, token)).catch(() => null);
        if (metadata && metadata.sessionId === sessionId) {
          results.push({
            token,
            sessionId: metadata.sessionId,
            targetId: metadata.targetId,
            fieldKey: metadata.fieldKey ?? '',
            originalName: metadata.originalName,
            mimeType: metadata.mimeType,
            size: metadata.size ?? 0,
            createdAt: new Date(metadata.createdAt),
          });
        }
      }
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
        const located = await this.locate(token);
        if (located) {
          await this.writeMetadata(located.dir, { ...located.metadata, expiresAt: newExpiresAt.toISOString() });
        }
      } catch {}
    }
  }

  /** Limpia solo archivos pendientes vencidos. Nunca toca `retained/`. */
  async cleanup(before: number): Promise<number> {
    await this.purgeDeleting();
    let removed = 0;

    if (this.repository) {
      const expired = await this.repository.listExpired(new Date(before));
      for (const record of expired) {
        try {
          const claimed = await this.claimForDeletion(this.pendingDir(record.token), record.token);
          if (claimed) {
            await this.repository.deleteMetadata(record.token);
            removed++;
          } else if (!(await this.readMetadata(join(this.options.rootDir, RETAINED_DIR, record.token)))) {
            // No está en ningún sitio: solo queda el rastro en la base.
            await this.repository.deleteMetadata(record.token);
          }
        } catch {}
      }
      return removed;
    }

    let entries: string[] = [];
    try {
      entries = await readdir(this.options.rootDir);
    } catch {
      return 0;
    }
    for (const token of entries) {
      if (!TOKEN_PATTERN.test(token)) continue;
      try {
        const metadata = await this.readMetadata(join(this.options.rootDir, token));
        if (!metadata) continue;
        const createdAt = new Date(metadata.createdAt).getTime();
        const expiresAt = metadata.expiresAt ? new Date(metadata.expiresAt).getTime() : createdAt + this.ttlMs;
        if (expiresAt < before && (await this.claimForDeletion(join(this.options.rootDir, token), token))) {
          removed++;
        }
      } catch {}
    }
    return removed;
  }

  /**
   * Borra archivos fijados hace más de lo indicado (`pinnedBefore`, en ms epoch) que ningún envío referencia
   * (caída entre fijar y guardar). Fuga acotada, sin pérdida de datos.
   */
  async cleanupRetainedOrphans(pinnedBefore: number, isReferenced: (token: string) => Promise<boolean>): Promise<number> {
    let removed = 0;
    let entries: string[] = [];
    try {
      entries = await readdir(join(this.options.rootDir, RETAINED_DIR));
    } catch {
      return 0;
    }
    for (const token of entries) {
      if (!TOKEN_PATTERN.test(token)) continue;
      const dir = join(this.options.rootDir, RETAINED_DIR, token);
      // Metadatos ilegibles: no se asume que el archivo sobra; se deja para revisión.
      const metadata = await this.readMetadata(dir).catch(() => null);
      if (!metadata) continue;
      const pinnedAt = new Date(metadata.pinnedAt ?? metadata.createdAt).getTime();
      if (pinnedAt >= pinnedBefore) continue;
      if (await isReferenced(token)) continue;
      if (await this.claimForDeletion(dir, token)) {
        await this.repository?.remove(token);
        removed++;
      }
    }
    return removed;
  }

  /** Borra los fijados cuya retención venció (el caso de recuperación asociado vence al mismo tiempo). */
  async cleanupExpiredRetained(before: number): Promise<number> {
    let removed = 0;
    let entries: string[] = [];
    try {
      entries = await readdir(join(this.options.rootDir, RETAINED_DIR));
    } catch {
      return 0;
    }
    for (const token of entries) {
      if (!TOKEN_PATTERN.test(token)) continue;
      const dir = join(this.options.rootDir, RETAINED_DIR, token);
      const metadata = await this.readMetadata(dir).catch(() => null);
      if (!metadata) continue;
      const expiresAt = metadata.expiresAt ? new Date(metadata.expiresAt).getTime() : Number.POSITIVE_INFINITY;
      if (expiresAt >= before) continue;
      if (await this.claimForDeletion(dir, token)) {
        await this.repository?.remove(token);
        removed++;
      }
    }
    return removed;
  }

  private pendingDir(token: string): string {
    this.assertToken(token);
    return join(this.options.rootDir, token);
  }

  private assertToken(token: string): void {
    if (!TOKEN_PATTERN.test(token)) throw new Error('Token de archivo inválido');
  }

  /** Encuentra el directorio del token: primero pendiente, luego fijado. */
  private async locate(token: string): Promise<{ dir: string; metadata: StoredMetadata; retained: boolean } | null> {
    this.assertToken(token);
    const pending = join(this.options.rootDir, token);
    const pendingMeta = await this.readMetadata(pending);
    if (pendingMeta) return { dir: pending, metadata: pendingMeta, retained: false };
    const retained = join(this.options.rootDir, RETAINED_DIR, token);
    const retainedMeta = await this.readMetadata(retained);
    if (retainedMeta) return { dir: retained, metadata: retainedMeta, retained: true };
    return null;
  }

  /**
   * Devuelve null SOLO si el archivo no existe. Cualquier otro fallo (JSON ilegible, permisos) se propaga:
   * "no se pudo leer" nunca debe interpretarse como "ya no existe".
   */
  private async readMetadata(dir: string): Promise<StoredMetadata | null> {
    let raw: string;
    try {
      raw = await readFile(join(dir, 'metadata.json'), 'utf8');
    } catch (error) {
      if (isFsError(error, ['ENOENT', 'ENOTDIR'])) return null;
      throw error;
    }
    return JSON.parse(raw) as StoredMetadata;
  }

  /** Escritura atómica: archivo temporal + rename, para que ningún lector vea un JSON a medio escribir. */
  private async writeMetadata(dir: string, metadata: StoredMetadata): Promise<void> {
    const temporary = join(dir, `metadata.json.${crypto.randomBytes(4).toString('hex')}.tmp`);
    await writeFile(temporary, JSON.stringify(metadata), { mode: 0o600 });
    try {
      await renameWithRetry(temporary, join(dir, 'metadata.json'));
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  /** Reclama `source` moviéndolo a `deleting/` y lo borra. Devuelve false si otro ya lo reclamó o no existe. */
  private async claimForDeletion(source: string, token: string): Promise<boolean> {
    const deletingRoot = join(this.options.rootDir, DELETING_DIR);
    await mkdir(deletingRoot, { recursive: true, mode: 0o700 });
    const target = join(deletingRoot, token);
    try {
      // Un destino residual de una caída anterior ya está reclamado: se descarta para no bloquear el rename.
      await rm(target, { recursive: true, force: true });
      await renameWithRetry(source, target);
    } catch (error) {
      if (isFsError(error, ['ENOENT'])) return false;
      throw error;
    }
    await rm(target, { recursive: true, force: true });
    return true;
  }

  /** Termina de borrar lo que quedó reclamado por un proceso que cayó a mitad. */
  private async purgeDeleting(): Promise<void> {
    const deletingRoot = join(this.options.rootDir, DELETING_DIR);
    try {
      for (const entry of await readdir(deletingRoot)) {
        await rm(join(deletingRoot, entry), { recursive: true, force: true });
      }
    } catch {}
  }

  /** Falla cerrada si `retained/` y `deleting/` no comparten volumen con la raíz (el `rename` dejaría de ser atómico). */
  async assertSameVolume(): Promise<void> {
    await mkdir(join(this.options.rootDir, RETAINED_DIR), { recursive: true, mode: 0o700 });
    await mkdir(join(this.options.rootDir, DELETING_DIR), { recursive: true, mode: 0o700 });
    const [root, retained, deleting] = await Promise.all([
      stat(this.options.rootDir),
      stat(join(this.options.rootDir, RETAINED_DIR)),
      stat(join(this.options.rootDir, DELETING_DIR)),
    ]);
    if (root.dev !== retained.dev || root.dev !== deleting.dev) {
      throw new Error('UPLOAD_TMP_DIR, retained/ y deleting/ deben estar en el mismo volumen.');
    }
  }
}

function isFsError(error: unknown, codes: string[]): boolean {
  return typeof error === 'object' && error !== null && codes.includes((error as NodeJS.ErrnoException).code ?? '');
}

/**
 * `rename` con reintentos cortos para EPERM/EBUSY: en Windows otra operación sobre la misma carpeta puede
 * dejarla abierta un instante. En Linux no ocurre. ENOENT no se reintenta: significa que otro la reclamó.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= 5 || !isFsError(error, ['EPERM', 'EBUSY', 'EACCES'])) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
