import type { AcademicTarget } from '@flacso/contracts';

export interface SpreadsheetDiscovery {
  targetId: string;
  spreadsheetId: string;
  sheetName: string;
  parentFolderId: string;
  url: string;
}

export interface SpreadsheetDiscoveryPort {
  findByTargetId(rootFolderId: string, targetId: string): Promise<SpreadsheetDiscovery | null>;
  moveToTargetFolder(input: { spreadsheetId: string; target: AcademicTarget; rootFolderId: string }): Promise<SpreadsheetDiscovery>;
  ensureTargetFolder?(rootFolderId: string, target: AcademicTarget): Promise<string>;
  moveSpreadsheet?(spreadsheetId: string, fromFolderId: string, toFolderId: string): Promise<void>;
  inspectSpreadsheet?(spreadsheetId: string): Promise<{ mimeType?: string; trashed?: boolean; parents?: string[]; appProperties?: Record<string, string> } | null>;
  setSpreadsheetAppProperties?(spreadsheetId: string, properties: Record<string, string>): Promise<void>;
}
