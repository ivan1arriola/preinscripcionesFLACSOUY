import type {
  SpreadsheetProvisioner,
  SpreadsheetProvisioningCommand,
  SpreadsheetProvisioned,
} from '../../application/target-spreadsheet-service.js';
import type { SheetsClient } from './sheets-client.js';

interface GoogleSpreadsheetProvisionerOptions {
  accessTokenOrProvider: string | (() => Promise<string>);
  sheetsClient: SheetsClient;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GoogleSpreadsheetProvisioner implements SpreadsheetProvisioner {
  private readonly tokenProvider: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GoogleSpreadsheetProvisionerOptions) {
    const rawTokenProvider = options.accessTokenOrProvider;
    this.tokenProvider = typeof rawTokenProvider === 'function'
      ? rawTokenProvider
      : async () => rawTokenProvider;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async create(command: SpreadsheetProvisioningCommand): Promise<SpreadsheetProvisioned> {
    const token = await this.tokenProvider();
    const response = await this.fetchImpl(
      'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: command.title,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [command.folderId],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      throw new Error(`Google Drive no permitió crear la planilla (HTTP ${response.status}).`);
    }
    const payload = await response.json() as { id?: string };
    if (!payload.id) throw new Error('Google Drive no devolvió el identificador de la planilla.');

    await this.options.sheetsClient.updateValues(
      payload.id,
      `${command.sheetName}!A1`,
      [command.headers],
    );

    return {
      spreadsheetId: payload.id,
      sheetName: command.sheetName,
      url: `https://docs.google.com/spreadsheets/d/${payload.id}/edit`,
    };
  }
}
