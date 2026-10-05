import type { AcademicTarget } from '@flacso/contracts';

export interface TargetSpreadsheetConfiguration {
  targetId: string;
  spreadsheetId: string;
  sheetName: string;
  url?: string;
  rootFolderId?: string;
  status?: 'reconciled' | 'created' | 'unchanged' | 'blocked' | 'detached';
  lastDiscoveredAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TargetSpreadsheetRepository {
  ensureTarget(target: AcademicTarget): Promise<void>;
  get(targetId: string): Promise<TargetSpreadsheetConfiguration | null>;
  list(): Promise<TargetSpreadsheetConfiguration[]>;
  save(configuration: TargetSpreadsheetConfiguration): Promise<void>;
}
