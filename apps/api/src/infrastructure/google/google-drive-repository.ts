import type {
  GoogleDriveFolderInfo,
  GoogleDriveRepositoryPort,
  StoreSubmissionFilesCommand,
  StoredDriveFile,
} from '../../ports/google-drive-repository.js';
import {
  buildDriveFolderNames,
  buildSemanticDriveFileName,
} from '../../domain/google-drive-naming.js';

interface GoogleDriveRepositoryOptions {
  folderId?: string;
  folderIdOrProvider?: string | (() => Promise<string>);
  accessTokenOrProvider: string | (() => Promise<string>);
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GoogleDriveRepository implements GoogleDriveRepositoryPort {
  private readonly tokenProvider: () => Promise<string>;
  private readonly folderIdProvider: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GoogleDriveRepositoryOptions) {
    this.tokenProvider = typeof options.accessTokenOrProvider === 'function'
      ? options.accessTokenOrProvider
      : async () => options.accessTokenOrProvider as string;

    const rawFolder = options.folderIdOrProvider ?? options.folderId;
    this.folderIdProvider = typeof rawFolder === 'function'
      ? rawFolder
      : async () => {
          if (!rawFolder) throw new Error('La carpeta raíz de Google Drive todavía no está configurada desde el panel administrativo.');
          return rawFolder;
        };

    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async inspectFolder(folderId: string): Promise<GoogleDriveFolderInfo> {
    const token = await this.tokenProvider();
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`Error de red al consultar la carpeta de Google Drive: ${error instanceof Error ? error.message : 'timeout'}`);
    }
    if (!response.ok) {
      throw new Error(`Google Drive no permitió leer la carpeta configurada (HTTP ${response.status}).`);
    }
    const payload = await response.json() as {
      id?: string;
      name?: string;
      mimeType?: string;
      capabilities?: { canAddChildren?: boolean };
    };
    if (!payload.id || !payload.name || payload.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('El identificador configurado no corresponde a una carpeta de Google Drive.');
    }
    return {
      id: payload.id,
      name: payload.name,
      canAddChildren: payload.capabilities?.canAddChildren === true,
    };
  }

  async storeSubmissionFiles(command: StoreSubmissionFilesCommand): Promise<StoredDriveFile[]> {
    const token = await this.tokenProvider();
    const folderId = await this.folderIdProvider();
    let uploadFolderId = folderId;
    if (command.target) {
      for (const name of buildDriveFolderNames(command.target)) {
        uploadFolderId = await this.ensureChildFolder(uploadFolderId, name, token);
      }
      await this.ensureChildFolder(uploadFolderId, 'Preinscripciones', token);
      uploadFolderId = await this.ensureChildFolder(uploadFolderId, 'Documentación', token);
    }
    const result: StoredDriveFile[] = [];
    const ordinals = new Map<string, number>();
    for (const file of command.files) {
      const boundary = `flacso-${command.submissionId}-${file.token}`;
      const ordinal = (ordinals.get(file.fieldKey ?? '') ?? 0) + 1;
      ordinals.set(file.fieldKey ?? '', ordinal);
      const fileName = command.target && command.values
        ? buildSemanticDriveFileName({
            submissionId: command.submissionId,
            fieldKey: file.fieldKey ?? 'documento',
            originalName: file.originalName,
            mimeType: file.mimeType,
            values: command.values,
            ordinal,
          })
        : file.originalName;
      const metadata = JSON.stringify({
        name: fileName,
        parents: [uploadFolderId],
        appProperties: {
          flacsoSubmissionId: command.submissionId,
          flacsoFileToken: file.token,
          flacsoTargetId: command.target?.targetId,
          flacsoFieldKey: file.fieldKey,
          flacsoOriginalName: file.originalName,
        },
      });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
        file.data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const response = await this.fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Google Drive API respondió con error HTTP ${response.status}`);
      }
      const payload = await response.json() as { id?: string };
      if (!payload.id) throw new Error('Google Drive no devolvió el identificador del archivo');
      result.push({ token: file.token, driveFileId: payload.id });
    }
    return result;
  }

  private async ensureChildFolder(parentId: string, name: string, token: string): Promise<string> {
    const query = [
      `'${parentId.replace(/'/g, "\\'")}' in parents`,
      `name = '${name.replace(/'/g, "\\'")}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      'trashed = false',
    ].join(' and ');
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const listResponse = await this.fetchImpl(listUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!listResponse.ok) {
      throw new Error(`Google Drive no permitió buscar la carpeta "${name}" (HTTP ${listResponse.status}).`);
    }
    const listPayload = await listResponse.json() as { files?: Array<{ id?: string }> };
    const existing = listPayload.files?.[0]?.id;
    if (existing) return existing;

    const createResponse = await this.fetchImpl('https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!createResponse.ok) {
      throw new Error(`Google Drive no permitió crear la carpeta "${name}" (HTTP ${createResponse.status}).`);
    }
    const created = await createResponse.json() as { id?: string };
    if (!created.id) throw new Error(`Google Drive no devolvió el identificador de la carpeta "${name}".`);
    return created.id;
  }
}
