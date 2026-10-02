import type {
  GoogleDriveFolderInfo,
  GoogleDriveRepositoryPort,
  StoreSubmissionFilesCommand,
  StoredDriveFile,
} from '../../ports/google-drive-repository.js';

interface GoogleDriveRepositoryOptions {
  folderId?: string;
  folderIdOrProvider?: string | (() => Promise<string>);
  accessTokenOrProvider: string | (() => Promise<string>);
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

import { buildDriveFolderNames, buildSemanticDriveFileName } from '../../domain/google-drive-naming.js';

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

  private async resolveOrCreateFolder(token: string, parentId: string, folderName: string): Promise<string> {
    const query = `'${parentId}' in parents and name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&supportsAllDrives=true`;
    
    const searchResponse = await this.fetchImpl(searchUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!searchResponse.ok) {
      throw new Error(`Error al buscar carpeta en Google Drive (HTTP ${searchResponse.status})`);
    }
    const searchPayload = await searchResponse.json() as { files?: { id: string }[] };
    if (searchPayload.files && searchPayload.files.length > 0 && searchPayload.files[0].id) {
      return searchPayload.files[0].id;
    }

    const createUrl = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true';
    const createResponse = await this.fetchImpl(createUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!createResponse.ok) {
      throw new Error(`Error al crear carpeta en Google Drive (HTTP ${createResponse.status})`);
    }
    const createPayload = await createResponse.json() as { id?: string };
    if (!createPayload.id) {
      throw new Error('Google Drive no devolvió el identificador de la carpeta creada');
    }
    return createPayload.id;
  }

  async storeSubmissionFiles(command: StoreSubmissionFilesCommand): Promise<StoredDriveFile[]> {
    const token = await this.tokenProvider();
    const rootFolderId = await this.folderIdProvider();
    
    let currentFolderId = rootFolderId;
    const hierarchy = buildDriveFolderNames(command.target);
    
    for (const folderName of hierarchy) {
      currentFolderId = await this.resolveOrCreateFolder(token, currentFolderId, folderName);
    }
    
    // Create or resolve sibling 'Preinscripciones' just to guarantee institutional structure, but we don't upload there.
    await this.resolveOrCreateFolder(token, currentFolderId, 'Preinscripciones');
    
    // Resolve 'Documentación' as the final destination
    const docsFolderId = await this.resolveOrCreateFolder(token, currentFolderId, 'Documentación');

    const result: StoredDriveFile[] = [];
    
    // Track ordinals to allow multiple files for the same fieldKey
    const ordinalCounters: Record<string, number> = {};

    for (const file of command.files) {
      const ordinal = ordinalCounters[file.fieldKey] ?? 0;
      ordinalCounters[file.fieldKey] = ordinal + 1;

      const semanticName = buildSemanticDriveFileName({
        submissionId: command.submissionId,
        fieldKey: file.fieldKey,
        originalName: file.originalName,
        mimeType: file.mimeType,
        values: command.values,
        ordinal,
      });

      const boundary = `flacso-${command.submissionId}-${file.token}`;
      const metadata = JSON.stringify({
        name: semanticName,
        parents: [docsFolderId],
        appProperties: { 
          flacsoSubmissionId: command.submissionId, 
          flacsoFileToken: file.token,
          flacsoTargetId: command.target.targetId,
          flacsoTargetKind: command.target.kind,
          flacsoDocumentKey: file.fieldKey,
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
}
