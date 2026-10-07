export class GoogleSheetsClientError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'GoogleSheetsClientError';
  }
}

export interface SheetMetadata {
  sheetId: number;
  title: string;
  index: number;
}

export interface SheetsClient {
  getValues(spreadsheetId: string, range: string): Promise<string[][]>;
  updateValues(
    spreadsheetId: string,
    range: string,
    values: string[][],
    valueInputOption?: 'RAW' | 'USER_ENTERED',
  ): Promise<void>;
  clearValues?(spreadsheetId: string, range: string): Promise<void>;
  insertRows(spreadsheetId: string, sheetId: number, startIndex: number, endIndex: number): Promise<void>;
  appendValues(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<{ updatedRange: string; updatedRows: number }>;
  getSheetMetadata?(spreadsheetId: string, sheetTitle?: string): Promise<SheetMetadata | null>;
}

export function buildSpreadsheetRowUrl(
  spreadsheetId: string,
  sheetId: number,
  updatedRange?: string
): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
  if (!updatedRange || typeof updatedRange !== 'string') {
    return `${base}#gid=${sheetId}`;
  }

  const exclamationIdx = updatedRange.lastIndexOf('!');
  const cellRange = exclamationIdx >= 0 ? updatedRange.slice(exclamationIdx + 1).trim() : updatedRange.trim();

  // Expected formats: A2:Z2, A5, B10:F10, etc.
  const isValidRange = /^[A-Za-z]+[0-9]+(?::[A-Za-z]+[0-9]+)?$/.test(cellRange);
  if (!isValidRange) {
    console.warn(`[Google Sheets] Rango inesperado al construir URL de fila: ${cellRange}`);
    return `${base}#gid=${sheetId}`;
  }

  return `${base}#gid=${sheetId}&range=${cellRange}`;
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

  private async executeFetch(
    url: string,
    init: RequestInit,
    errorContext: string,
    maxRetries = 3
  ): Promise<Response> {
    let attempt = 0;
    while (true) {
      attempt++;
      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt <= maxRetries) {
          const backoffMs = Math.min(10000, 1000 * Math.pow(2, attempt - 1));
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw new GoogleSheetsClientError(
          `Error de red ${errorContext}: ${err instanceof Error ? err.message : 'timeout'}`
        );
      }

      if ((res.status === 429 || res.status === 503) && attempt <= maxRetries) {
        const retryAfterHeader = res.headers.get('retry-after');
        const parsedRetryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
        const backoffMs = parsedRetryAfter !== null && !isNaN(parsedRetryAfter) && parsedRetryAfter >= 0
          ? Math.max(100, parsedRetryAfter)
          : Math.min(30000, 2000 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      return res;
    }
  }

  async getValues(spreadsheetId: string, range: string): Promise<string[][]> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}`;

    const res = await this.executeFetch(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      'al consultar Google Sheets'
    );

    if (!res.ok) {
      const details = await readGoogleApiError(res);
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status}${details ? `: ${details}` : ''}`,
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

    const res = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ values }),
      },
      'al insertar fila en Google Sheets'
    );

    if (!res.ok) {
      const details = await readGoogleApiError(res);
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status} al insertar fila${details ? `: ${details}` : ''}`,
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

  async insertRows(
    spreadsheetId: string,
    sheetId: number,
    startIndex: number,
    endIndex: number,
  ): Promise<void> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;

    const res = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          requests: [{
            insertDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex,
                endIndex,
              },
              inheritFromBefore: false,
            },
          }],
        }),
      },
      'al insertar una fila en Google Sheets'
    );

    if (!res.ok) {
      const details = await readGoogleApiError(res);
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status} al insertar una fila${details ? `: ${details}` : ''}`,
        res.status
      );
    }
  }

  async updateValues(
    spreadsheetId: string,
    range: string,
    values: string[][],
    valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW',
  ): Promise<void> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`;

    const res = await this.executeFetch(
      url,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
      },
      'al crear los encabezados de Google Sheets'
    );

    if (!res.ok) {
      const details = await readGoogleApiError(res);
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status} al crear los encabezados${details ? `: ${details}` : ''}`,
        res.status
      );
    }
  }

  async clearValues(spreadsheetId: string, range: string): Promise<void> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}:clear`;

    const res = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: '{}',
      },
      'al limpiar columnas obsoletas de Google Sheets'
    );

    if (!res.ok) {
      const details = await readGoogleApiError(res);
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status} al limpiar columnas obsoletas${details ? `: ${details}` : ''}`,
        res.status
      );
    }
  }

  async getSheetMetadata(spreadsheetId: string, sheetTitle?: string): Promise<SheetMetadata | null> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=sheets.properties`;

    const res = await this.executeFetch(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      'al consultar metadata de Google Sheets'
    );

    if (!res.ok) {
      const details = await readGoogleApiError(res);
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status} al consultar metadata${details ? `: ${details}` : ''}`,
        res.status
      );
    }

    const data = (await res.json()) as {
      sheets?: Array<{
        properties?: {
          sheetId?: number;
          title?: string;
          index?: number;
        };
      }>;
    };

    const sheets = data.sheets ?? [];
    if (sheets.length === 0) return null;

    if (sheetTitle) {
      const match = sheets.find(
        (s) => s.properties?.title?.trim().toLowerCase() === sheetTitle.trim().toLowerCase()
      );
      if (match?.properties && typeof match.properties.sheetId === 'number') {
        return {
          sheetId: match.properties.sheetId,
          title: match.properties.title ?? sheetTitle,
          index: match.properties.index ?? 0,
        };
      }
    }

    const first = sheets[0]?.properties;
    if (first && typeof first.sheetId === 'number') {
      return {
        sheetId: first.sheetId,
        title: first.title ?? sheetTitle ?? 'Sheet1',
        index: first.index ?? 0,
      };
    }

    return null;
  }
}

async function readGoogleApiError(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    const message = payload.error?.message?.trim();
    return message ? message.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}
