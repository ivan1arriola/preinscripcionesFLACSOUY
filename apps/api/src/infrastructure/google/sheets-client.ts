export class GoogleSheetsClientError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'GoogleSheetsClientError';
  }
}

export interface SheetsClient {
  getValues(spreadsheetId: string, range: string): Promise<string[][]>;
  updateValues(spreadsheetId: string, range: string, values: string[][]): Promise<void>;
  appendValues(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<{ updatedRange: string; updatedRows: number }>;
}

export interface HttpSheetsClientOptions {
  accessTokenOrProvider: string | (() => Promise<string>);
  timeoutMs?: number;
}

export class HttpGoogleSheetsClient implements SheetsClient {
  private readonly tokenProvider: () => Promise<string>;
  private readonly timeoutMs: number;

  constructor(options: HttpSheetsClientOptions) {
    const raw = options.accessTokenOrProvider;
    this.tokenProvider = typeof raw === 'function' ? raw : async () => raw;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  async getValues(spreadsheetId: string, range: string): Promise<string[][]> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new GoogleSheetsClientError(
        `Error de red al consultar Google Sheets: ${err instanceof Error ? err.message : 'timeout'}`
      );
    }

    if (!res.ok) {
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status}`,
        res.status
      );
    }

    const data = (await res.json()) as { values?: string[][] };
    return data.values ?? [];
  }

  async appendValues(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<{ updatedRange: string; updatedRows: number }> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ values }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new GoogleSheetsClientError(
        `Error de red al insertar fila en Google Sheets: ${err instanceof Error ? err.message : 'timeout'}`
      );
    }

    if (!res.ok) {
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status} al insertar fila`,
        res.status
      );
    }

    const data = (await res.json()) as {
      updates?: { updatedRange?: string; updatedRows?: number };
    };

    return {
      updatedRange: data.updates?.updatedRange ?? range,
      updatedRows: data.updates?.updatedRows ?? values.length,
    };
  }

  async updateValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new GoogleSheetsClientError(
        `Error de red al crear los encabezados de Google Sheets: ${err instanceof Error ? err.message : 'timeout'}`
      );
    }

    if (!res.ok) {
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status} al crear los encabezados`,
        res.status
      );
    }
  }
}
