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
      const details = await readGoogleError(response);
      if (details.reason === 'storageQuotaExceeded') {
        throw new Error('Google Drive no puede crear la planilla porque las cuentas de servicio no tienen cuota de almacenamiento en Mi unidad. Configurá una carpeta dentro de una Unidad compartida o usá OAuth de una cuenta institucional.');
      }
      throw new Error(`Google Drive no permitió crear la planilla (HTTP ${response.status}${details.message ? `: ${details.message}` : ''}).`);
    }
    const payload = await response.json() as { id?: string };
    if (!payload.id) throw new Error('Google Drive no devolvió el identificador de la planilla.');

    const sheetName = await this.readInitialSheetName(payload.id);
    await this.options.sheetsClient.updateValues(
      payload.id,
      `${toSheetRange(sheetName)}!A1`,
      [command.headers],
    );

    return {
      spreadsheetId: payload.id,
      sheetName,
      url: `https://docs.google.com/spreadsheets/d/${payload.id}/edit`,
    };
  }

  private async readInitialSheetName(spreadsheetId: string): Promise<string> {
    const token = await this.tokenProvider();
    const response = await this.fetchImpl(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Sheets no permitió consultar la hoja inicial (HTTP ${response.status}).`);
    }
    const payload = await response.json() as { sheets?: Array<{ properties?: { title?: string } }> };
    const title = payload.sheets?.[0]?.properties?.title;
    if (!title) throw new Error('Google Sheets no devolvió el nombre de la hoja inicial.');
    return title;
  }
}

function toSheetRange(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

async function readGoogleError(response: Response): Promise<{ reason?: string; message?: string }> {
  try {
    const payload = await response.json() as {
      error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> };
    };
    const detail = payload.error?.errors?.[0];
    return { reason: detail?.reason, message: detail?.message ?? payload.error?.message };
  } catch {
    return {};
  }
}
