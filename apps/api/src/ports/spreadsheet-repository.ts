import type { SpreadsheetHeaderDiagnostic } from '../domain/spreadsheet-row.js';

export interface AppendResult {
  spreadsheetId: string;
  sheetName: string;
  sheetId: number;
  updatedRange: string;
  rowUrl: string;
  updatedRows: number;
}

export interface SpreadsheetDiagnostic {
  spreadsheetId: string;
  accessible: boolean;
  sheetFound: boolean;
  headerDiagnostic: SpreadsheetHeaderDiagnostic;
  error?: string;
}

export interface SpreadsheetRepository {
  readHeaders(spreadsheetId: string, sheetName?: string): Promise<string[]>;
  appendByHeaders(
    spreadsheetId: string,
    valuesByColumnName: Record<string, string>,
    requiredColumns: string[],
    sheetName?: string
  ): Promise<AppendResult>;
  diagnose(
    spreadsheetId: string,
    requiredColumns: string[],
    sheetName?: string
  ): Promise<SpreadsheetDiagnostic>;
  synchronizeSchema?(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void>;
}
