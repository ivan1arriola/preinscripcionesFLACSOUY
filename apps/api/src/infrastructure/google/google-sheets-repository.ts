import type { AgreementOption } from '@flacso/contracts';
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
import { collapseLegacySpreadsheetRow, SPREADSHEET_TRACKING_COLUMN } from '../../domain/spreadsheet-schema.js';
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

  async countTrackingId(
    spreadsheetId: string,
    sheetName = 'Sheet1',
    trackingId: string
  ): Promise<number> {
    const actualSheetName = await this.resolveSheetName(spreadsheetId, sheetName);
    const range = `${toSheetRange(actualSheetName)}!A:ZZ`;
    const columns = await this.client.getValues(spreadsheetId, range, 'COLUMNS');

    if (!columns || columns.length === 0) {
      throw new Error(
        `Columna "${SPREADSHEET_TRACKING_COLUMN}" no encontrada en la planilla ${spreadsheetId} hoja "${actualSheetName}"`
      );
    }

    const trackingColumn = columns.find(
      (col) => col[0]?.trim() === SPREADSHEET_TRACKING_COLUMN
    );

    if (!trackingColumn) {
      throw new Error(
        `Columna "${SPREADSHEET_TRACKING_COLUMN}" no encontrada en la planilla ${spreadsheetId} hoja "${actualSheetName}"`
      );
    }

    const trimmedTarget = trackingId.trim();
    return trackingColumn.slice(1).filter((cell) => cell.trim() === trimmedTarget).length;
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
    // Insertar la fila 2 y escribirla son dos llamadas: sin serializar, dos envíos simultáneos a la misma
    // planilla escribirían ambos en la fila 2 y uno pisaría al otro.
    return this.serializePerSpreadsheet(spreadsheetId, () =>
      this.appendByHeadersUnlocked(spreadsheetId, valuesByColumnName, requiredColumns, sheetName),
    );
  }

  private readonly writeQueues = new Map<string, Promise<unknown>>();

  private serializePerSpreadsheet<T>(spreadsheetId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(spreadsheetId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);
    this.writeQueues.set(spreadsheetId, tail);
    void tail.then(() => {
      if (this.writeQueues.get(spreadsheetId) === tail) this.writeQueues.delete(spreadsheetId);
    });
    return run;
  }

  private async appendByHeadersUnlocked(
    spreadsheetId: string,
    valuesByColumnName: Record<string, string>,
    requiredColumns: string[],
    sheetName: string,
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

    const rowRange = `${toSheetRange(actualSheetName)}!A2:${columnName(buildResult.row.length)}2`;

    if (this.client.batchUpdate) {
      const cellValues = buildResult.row.map((cell) => {
        if (cell.startsWith('=')) {
          return {
            userEnteredValue: {
              formulaValue: cell,
            },
          };
        }
        return {
          userEnteredValue: {
            stringValue: cell,
          },
        };
      });

      await this.client.batchUpdate(spreadsheetId, [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: 1,
              endIndex: 2,
            },
            inheritFromBefore: false,
          },
        },
        {
          updateCells: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 0,
              endColumnIndex: buildResult.row.length,
            },
            rows: [
              {
                values: cellValues,
              },
            ],
            fields: 'userEnteredValue',
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 2,
            },
            cell: {},
            fields:
              'userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.foregroundColorStyle',
          },
        },
      ]);
    } else {
      await this.client.insertRows(spreadsheetId, sheetId, 1, 2);
      await this.client.updateValues(spreadsheetId, rowRange, [buildResult.row], 'USER_ENTERED');
    }

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

  async synchronizeSchema(
    spreadsheetId: string,
    sheetName: string,
    headers: string[],
    agreements: AgreementOption[] = [],
  ): Promise<void> {
    const actualSheetName = await this.resolveSheetName(spreadsheetId, sheetName);
    const currentRows = await this.client.getValues(spreadsheetId, `${toSheetRange(actualSheetName)}!A1:ZZ`);
    const currentHeaders = currentRows[0] ?? [];
    const dataRows = currentRows
      .slice(1)
      .map((row) => collapseLegacySpreadsheetRow(currentHeaders, row, headers, agreements));
    const output = [headers, ...dataRows];
    const lastRow = Math.max(output.length, 1);
    const targetRange = `${toSheetRange(actualSheetName)}!A1:${columnName(headers.length)}${lastRow}`;

    await this.client.updateValues(spreadsheetId, targetRange, output, 'USER_ENTERED');

    if (currentHeaders.length > headers.length) {
      const obsoleteRange = `${toSheetRange(actualSheetName)}!${columnName(headers.length + 1)}1:${columnName(currentHeaders.length)}${lastRow}`;
      if (!this.client.clearValues) {
        throw new Error('El cliente de Google Sheets no permite limpiar columnas obsoletas.');
      }
      await this.client.clearValues(spreadsheetId, obsoleteRange);
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
