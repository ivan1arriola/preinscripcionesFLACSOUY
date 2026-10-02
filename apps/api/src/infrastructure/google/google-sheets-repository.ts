import type {
  SpreadsheetRepository,
  AppendResult,
  SpreadsheetDiagnostic,
} from '../../ports/spreadsheet-repository.js';
import {
  buildSpreadsheetRow,
  validateSpreadsheetHeaders,
} from '../../domain/spreadsheet-row.js';
import type { SheetsClient } from './sheets-client.js';

export class IncompatibleSpreadsheetError extends Error {
  constructor(message: string, public readonly missingColumns: string[]) {
    super(message);
    this.name = 'IncompatibleSpreadsheetError';
  }
}

export class GoogleSheetsRepository implements SpreadsheetRepository {
  constructor(private readonly client: SheetsClient) {}

  async readHeaders(spreadsheetId: string, sheetName = 'Sheet1'): Promise<string[]> {
    const range = `${sheetName}!1:1`;
    const rows = await this.client.getValues(spreadsheetId, range);
    if (!rows || rows.length === 0) {
      return [];
    }
    return rows[0] ?? [];
  }

  async appendByHeaders(
    spreadsheetId: string,
    valuesByColumnName: Record<string, string>,
    requiredColumns: string[],
    sheetName = 'Sheet1'
  ): Promise<AppendResult> {
    const headers = await this.readHeaders(spreadsheetId, sheetName);
    const buildResult = buildSpreadsheetRow(headers, valuesByColumnName, requiredColumns);

    if (!buildResult.success) {
      throw new IncompatibleSpreadsheetError(
        `El Spreadsheet no contiene todas las columnas requeridas: ${buildResult.missingColumns.join(', ')}`,
        buildResult.missingColumns
      );
    }

    const range = `${sheetName}!A:A`;
    const res = await this.client.appendValues(spreadsheetId, range, [buildResult.row]);

    return {
      spreadsheetId,
      updatedRange: res.updatedRange,
      updatedRows: res.updatedRows,
    };
  }

  async diagnose(
    spreadsheetId: string,
    requiredColumns: string[],
    sheetName = 'Sheet1'
  ): Promise<SpreadsheetDiagnostic> {
    try {
      const headers = await this.readHeaders(spreadsheetId, sheetName);
      const headerDiagnostic = validateSpreadsheetHeaders(headers, requiredColumns);

      return {
        spreadsheetId,
        accessible: true,
        sheetFound: headers.length > 0,
        headerDiagnostic,
      };
    } catch (err) {
      return {
        spreadsheetId,
        accessible: false,
        sheetFound: false,
        headerDiagnostic: {
          valid: false,
          foundColumns: [],
          missingColumns: requiredColumns,
          extraColumns: [],
        },
        error: err instanceof Error ? err.message : 'Error desconocido al acceder al Spreadsheet',
      };
    }
  }
}
