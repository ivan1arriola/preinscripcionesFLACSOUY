import type {
  SpreadsheetRepository,
  AppendResult,
  SpreadsheetDiagnostic,
} from '../../ports/spreadsheet-repository.js';
import {
  buildSpreadsheetRow,
  resolveAdditiveHeaders,
  validateSpreadsheetHeaders,
} from '../../domain/spreadsheet-row.js';
import { type SheetsClient, buildSpreadsheetRowUrl } from './sheets-client.js';

export class IncompatibleSpreadsheetError extends Error {
  constructor(message: string, public readonly missingColumns: string[]) {
    super(message);
    this.name = 'IncompatibleSpreadsheetError';
  }
}

export class SpreadsheetSchemaRepairError extends IncompatibleSpreadsheetError {
  constructor(missingColumns: string[], public readonly cause?: unknown) {
    super(
      `No se pudieron reparar las columnas faltantes en la planilla: ${missingColumns.join(', ')}`,
      missingColumns
    );
    this.name = 'SpreadsheetSchemaRepairError';
  }
}

export class GoogleSheetsRepository implements SpreadsheetRepository {
  constructor(private readonly client: SheetsClient) {}

  async readHeaders(spreadsheetId: string, sheetName = 'Sheet1'): Promise<string[]> {
    const actualSheetName = await this.resolveSheetName(spreadsheetId, sheetName);
    return this.readHeadersFromSheet(spreadsheetId, actualSheetName);
  }

  private async readHeadersFromSheet(spreadsheetId: string, sheetName: string): Promise<string[]> {
    const range = `${toSheetRange(sheetName)}!A1:ZZ1`;
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
    const actualSheetName = await this.resolveSheetName(spreadsheetId, sheetName);
    let headers = await this.readHeadersFromSheet(spreadsheetId, actualSheetName);
    let buildResult = buildSpreadsheetRow(headers, valuesByColumnName, requiredColumns);

    if (!buildResult.success) {
      const initialMissingColumns = buildResult.missingColumns;
      const { updatedHeaders, missingColumnsAdded } = resolveAdditiveHeaders(headers, requiredColumns);

      if (missingColumnsAdded.length > 0) {
        try {
          const headerRange = `${toSheetRange(actualSheetName)}!A1:ZZ1`;
          await this.client.updateValues(spreadsheetId, headerRange, [updatedHeaders]);
          headers = updatedHeaders;
          buildResult = buildSpreadsheetRow(headers, valuesByColumnName, requiredColumns);
        } catch (repairError) {
          throw new SpreadsheetSchemaRepairError(initialMissingColumns, repairError);
        }
      }

      if (!buildResult.success) {
        throw new SpreadsheetSchemaRepairError(buildResult.missingColumns);
      }
    }

    let sheetId = 0;
    if (this.client.getSheetMetadata) {
      try {
        const meta = await this.client.getSheetMetadata(spreadsheetId, actualSheetName);
        if (meta && typeof meta.sheetId === 'number') {
          sheetId = meta.sheetId;
        }
      } catch {
        // Fallback to 0 if metadata cannot be queried
      }
    }

    await this.client.insertRows(spreadsheetId, sheetId, 1, 2);

    const rowRange = `${toSheetRange(actualSheetName)}!A2:${columnName(buildResult.row.length)}2`;
    await this.client.updateValues(spreadsheetId, rowRange, [buildResult.row], 'USER_ENTERED');

    const rowUrl = buildSpreadsheetRowUrl(spreadsheetId, sheetId, rowRange);

    return {
      spreadsheetId,
      sheetName: actualSheetName,
      sheetId,
      updatedRange: rowRange,
      rowUrl,
      updatedRows: 1,
    };
  }

  async diagnose(
    spreadsheetId: string,
    requiredColumns: string[],
    sheetName = 'Sheet1'
  ): Promise<SpreadsheetDiagnostic> {
    try {
      const actualSheetName = await this.resolveSheetName(spreadsheetId, sheetName);
      const headers = await this.readHeadersFromSheet(spreadsheetId, actualSheetName);
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

  private async resolveSheetName(spreadsheetId: string, requestedSheetName: string): Promise<string> {
    if (!this.client.getSheetMetadata) return requestedSheetName;

    try {
      const metadata = await this.client.getSheetMetadata(spreadsheetId, requestedSheetName);
      return metadata?.title?.trim() || requestedSheetName;
    } catch {
      return requestedSheetName;
    }
  }
}

function columnName(columnNumber: number): string {
  let current = columnNumber;
  let result = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result || 'A';
}

function toSheetRange(sheetName: string): string {
  const normalized = sheetName.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)
    ? normalized
    : `'${normalized.replace(/'/g, "''")}'`;
}
