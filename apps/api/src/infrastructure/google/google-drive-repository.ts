import type { GoogleDriveRepositoryPort, StoreSubmissionFilesCommand, StoredDriveFile } from '../../ports/google-drive-repository.js';

interface GoogleDriveRepositoryOptions {
  folderId: string;
  accessTokenOrProvider: string | (() => Promise<string>);
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GoogleDriveRepository implements GoogleDriveRepositoryPort {
  private readonly tokenProvider: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GoogleDriveRepositoryOptions) {
    this.tokenProvider = typeof options.accessTokenOrProvider === 'function'
      ? options.accessTokenOrProvider
      : async () => options.accessTokenOrProvider as string;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async storeSubmissionFiles(command: StoreSubmissionFilesCommand): Promise<StoredDriveFile[]> {
    const token = await this.tokenProvider();
    const result: StoredDriveFile[] = [];
    for (const file of command.files) {
      const boundary = `flacso-${command.submissionId}-${file.token}`;
      const metadata = JSON.stringify({
        name: file.originalName,
        parents: [this.options.folderId],
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
