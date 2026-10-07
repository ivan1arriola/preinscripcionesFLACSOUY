import {
  getCanonicalFormDefinition,
  type AgreementOption,
  type FormDefinition,
} from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SheetsClient } from '../infrastructure/google/sheets-client.js';
import type { TargetSpreadsheetRepository } from '../ports/target-spreadsheet-repository.js';
import {
  buildSpreadsheetSchema,
  buildSpreadsheetValues,
  collapseLegacySpreadsheetRow,
  SPREADSHEET_TRACKING_COLUMN,
} from '../domain/spreadsheet-schema.js';
import { normalizeIdentityValues } from '../domain/identity-validation.js';

export interface MigrationSubmissionData {
  id: string;
  submittedAt: Date;
  values: Record<string, string>;
  files: Array<{ fieldKey: string; token: string; driveFileId?: string | null }>;
  documentsFolderUrl?: string;
}

export interface MigrateSpreadsheetsDependencies {
  targetSpreadsheetRepository: TargetSpreadsheetRepository;
  catalog: AcademicCatalog;
  sheetsClient: SheetsClient;
  getSubmissionsForTarget: (targetId: string) => Promise<MigrationSubmissionData[]>;
}

export interface TargetMigrationResult {
  targetId: string;
  spreadsheetId: string;
  sheetName: string;
  totalRows: number;
  matchedDbSubmissions: number;
  manualRowsPreserved: number;
  dryRun: boolean;
  status: 'migrated' | 'skipped' | 'failed';
  error?: string;
}

export interface MigrationSummary {
  targetsProcessed: number;
  results: TargetMigrationResult[];
  dryRun: boolean;
}

export interface MigrateOptions {
  dryRun?: boolean;
  targetId?: string;
  throttleMs?: number;
  onProgress?: (progress: {
    current: number;
    total: number;
    targetId: string;
    result: TargetMigrationResult;
  }) => void;
}

function toSheetRange(sheetName: string): string {
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) return sheetName;
  if (/^[A-Za-z0-9_]+$/.test(sheetName)) return sheetName;
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export async function migrateTargetSpreadsheets(
  dependencies: MigrateSpreadsheetsDependencies,
  options: MigrateOptions = {}
): Promise<MigrationSummary> {
  const dryRun = options.dryRun ?? false;
  const throttleMs = options.throttleMs ?? 1500;
  const configurations = await dependencies.targetSpreadsheetRepository.list();

  const targetsToMigrate = options.targetId
    ? configurations.filter((c) => c.targetId === options.targetId)
    : configurations;

  const agreements = dependencies.catalog.listAgreements
    ? await dependencies.catalog.listAgreements()
    : [];

  const results: TargetMigrationResult[] = [];

  for (let i = 0; i < targetsToMigrate.length; i++) {
    const config = targetsToMigrate[i]!;

    if (i > 0 && throttleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }

    try {
      const result = await migrateSingleSpreadsheet(
        config.targetId,
        config.spreadsheetId,
        config.sheetName || 'Preinscripciones',
        agreements,
        dependencies,
        dryRun
      );
      results.push(result);
      options.onProgress?.({
        current: i + 1,
        total: targetsToMigrate.length,
        targetId: config.targetId,
        result,
      });
    } catch (err) {
      const result: TargetMigrationResult = {
        targetId: config.targetId,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName || 'Preinscripciones',
        totalRows: 0,
        matchedDbSubmissions: 0,
        manualRowsPreserved: 0,
        dryRun,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
      results.push(result);
      options.onProgress?.({
        current: i + 1,
        total: targetsToMigrate.length,
        targetId: config.targetId,
        result,
      });
    }
  }

  return {
    targetsProcessed: results.length,
    results,
    dryRun,
  };
}

async function migrateSingleSpreadsheet(
  targetId: string,
  spreadsheetId: string,
  sheetName: string,
  agreements: AgreementOption[],
  dependencies: MigrateSpreadsheetsDependencies,
  dryRun: boolean
): Promise<TargetMigrationResult> {
  const target = (await dependencies.catalog.revalidateTarget(targetId))
    ?? (dependencies.catalog.getTarget ? await dependencies.catalog.getTarget(targetId) : null);

  if (!target) {
    return {
      targetId,
      spreadsheetId,
      sheetName,
      totalRows: 0,
      matchedDbSubmissions: 0,
      manualRowsPreserved: 0,
      dryRun,
      status: 'skipped',
      error: `No se encontró el destino académico "${targetId}" en el catálogo`,
    };
  }

  let actualSheetName = sheetName;
  if (dependencies.sheetsClient.getSheetMetadata) {
    try {
      const meta = await dependencies.sheetsClient.getSheetMetadata(spreadsheetId, sheetName);
      if (meta?.title?.trim()) {
        actualSheetName = meta.title.trim();
      }
    } catch {
      // Fallback to configured sheetName if query fails
    }
  }

  const composition = getCanonicalFormDefinition(target, agreements);
  const form: FormDefinition = composition.ok ? composition.value : (target as any);
  const { headers: targetHeaders } = buildSpreadsheetSchema(form);

  const sheetRange = toSheetRange(actualSheetName);

  const existingSheetData = await dependencies.sheetsClient.getValues(
    spreadsheetId,
    `${sheetRange}!A1:ZZ`
  );

  const existingRows = existingSheetData ?? [];
  const oldHeaders = existingRows[0] ?? [];
  const oldDataRows = existingRows.slice(1);

  const dbSubmissions = await dependencies.getSubmissionsForTarget(targetId);
  const dbSubmissionsMap = new Map<string, MigrationSubmissionData>();
  for (const sub of dbSubmissions) {
    dbSubmissionsMap.set(sub.id.trim(), sub);
  }

  const oldTrackingIdx = oldHeaders.findIndex(
    (h) => h.trim().toLowerCase() === SPREADSHEET_TRACKING_COLUMN.toLowerCase()
  );

  let matchedDbSubmissions = 0;
  let manualRowsPreserved = 0;

  const migratedDataRows: string[][] = [];

  for (const row of oldDataRows) {
    const rawId = oldTrackingIdx >= 0 ? (row[oldTrackingIdx] ?? '').trim() : '';
    const dbSub = rawId ? dbSubmissionsMap.get(rawId) : undefined;

    if (dbSub) {
      matchedDbSubmissions += 1;
      const normalizedValues = normalizeIdentityValues(dbSub.values);
      const rowValuesMap = buildSpreadsheetValues(
        form,
        normalizedValues,
        dbSub.id,
        dbSub.submittedAt,
        {
          documentsFolderUrl: dbSub.documentsFolderUrl,
          files: dbSub.files.map((f) => ({
            fieldKey: f.fieldKey,
            token: f.token,
            driveFileId: f.driveFileId ?? undefined,
          })),
        }
      );
      const newRow = targetHeaders.map((col) => rowValuesMap[col] ?? '');
      migratedDataRows.push(newRow);
    } else {
      manualRowsPreserved += 1;
      const legacyRow = collapseLegacySpreadsheetRow(oldHeaders, row, targetHeaders, agreements);
      migratedDataRows.push(legacyRow);
    }
  }

  const newSpreadsheetData = [targetHeaders, ...migratedDataRows];

  if (!dryRun) {
    if (dependencies.sheetsClient.clearValues && existingRows.length > 0) {
      const clearRange = `${sheetRange}!A1:ZZ${Math.max(existingRows.length, newSpreadsheetData.length) + 10}`;
      try {
        await dependencies.sheetsClient.clearValues(spreadsheetId, clearRange);
      } catch {
        // Safe ignore if clear fails on empty or non-existent range
      }
    }

    const updateRange = `${sheetRange}!A1`;
    await dependencies.sheetsClient.updateValues(
      spreadsheetId,
      updateRange,
      newSpreadsheetData,
      'USER_ENTERED'
    );

    if (actualSheetName !== sheetName) {
      try {
        const currentConfig = await dependencies.targetSpreadsheetRepository.get(targetId);
        if (currentConfig) {
          await dependencies.targetSpreadsheetRepository.save({
            ...currentConfig,
            sheetName: actualSheetName,
            updatedAt: new Date(),
          });
        }
      } catch {
        // Non-fatal if updating target repository fails
      }
    }
  }

  return {
    targetId,
    spreadsheetId,
    sheetName: actualSheetName,
    totalRows: oldDataRows.length,
    matchedDbSubmissions,
    manualRowsPreserved,
    dryRun,
    status: 'migrated',
  };
}
