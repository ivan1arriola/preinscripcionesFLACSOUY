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
    const result: StoredDriveFile[] = [];
    for (const file of command.files) {
      const boundary = `flacso-${command.submissionId}-${file.token}`;
      const metadata = JSON.stringify({
        name: file.originalName,
        parents: [folderId],
        appProperties: { flacsoSubmissionId: command.submissionId, flacsoFileToken: file.token },
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
