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
  updateValues(spreadsheetId: string, range: string, values: string[][]): Promise<void>;
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

  async getSheetMetadata(spreadsheetId: string, sheetTitle?: string): Promise<SheetMetadata | null> {
    const token = await this.tokenProvider();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=sheets.properties`;

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
        `Error de red al consultar metadata de Google Sheets: ${err instanceof Error ? err.message : 'timeout'}`
      );
    }

    if (!res.ok) {
      throw new GoogleSheetsClientError(
        `Google Sheets API respondió con error HTTP ${res.status} al consultar metadata`,
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
