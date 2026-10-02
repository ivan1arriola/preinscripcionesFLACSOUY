import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import type { DriveRepository } from '../../ports/drive-repository.js';
import type {
  SystemErrorRepository,
  FindErrorsFilter,
} from '../../ports/system-error-repository.js';
import type { SystemErrorRecord } from '../../domain/system-error.js';
import { diagnoseTarget } from '../../domain/diagnostics.js';
import type { DiagnosticTarget } from '@flacso/contracts';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/schema.js';

export interface AdminServiceDependencies {
  catalog: AcademicCatalog;
  spreadsheetRepo?: SpreadsheetRepository;
  driveRepo?: DriveRepository;
  errorRepo?: SystemErrorRepository;
  db?: Kysely<DatabaseSchema>;
  checkDatabase?: () => Promise<boolean>;
}

export interface TargetDeepDiagnostic {
  targetId: string;
  title: string;
  status: 'healthy' | 'warning' | 'error';
  wordpress: {
    status: 'ok' | 'warning' | 'error';
    valid: boolean;
    issues: string[];
    configRevision: string;
    registrationOpen: boolean;
    inputsCount: number;
  };
  sheets: {
    status: 'ok' | 'warning' | 'error' | 'not_configured';
    spreadsheetId?: string;
    sheetName?: string;
    missingColumns: string[];
    foundColumns: string[];
    issues: string[];
  };
  drive: {
    status: 'ok' | 'warning' | 'error' | 'not_configured';
    targetFolderId?: string;
    documentsFolderId?: string;
    issues: string[];
  };
  checkedAt: string;
}

export interface IntegrationsHealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  integrations: {
    wordpress: { status: 'healthy' | 'degraded' | 'unhealthy'; message?: string };
    database: { status: 'healthy' | 'unhealthy'; message?: string };
    googleSheets: { status: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured'; message?: string };
    googleDrive: { status: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured'; message?: string };
  };
}

export class AdminService {
  constructor(private readonly deps: AdminServiceDependencies) {}

  async listTargets(): Promise<DiagnosticTarget[]> {
    const targets = await this.deps.catalog.listTargets();
    return targets.map((target) => diagnoseTarget(target));
  }

  async diagnoseTarget(targetId: string): Promise<TargetDeepDiagnostic> {
    const target = await this.deps.catalog.getTarget(targetId);
    const checkedAt = new Date().toISOString();

    if (!target) {
      return {
        targetId,
        title: 'Desconocido',
        status: 'error',
        wordpress: {
          status: 'error',
          valid: false,
          issues: [`Target '${targetId}' no encontrado en el catálogo académico`],
          configRevision: 'none',
          registrationOpen: false,
          inputsCount: 0,
        },
        sheets: {
          status: 'not_configured',
          missingColumns: [],
          foundColumns: [],
          issues: [],
        },
        drive: {
          status: 'not_configured',
          issues: [],
        },
        checkedAt,
      };
    }

    // 1. WordPress evaluation
    const wpIssues: string[] = [];
    if (!target.form.valid) {
      wpIssues.push(...target.form.issues);
    }
    const wpStatus: 'ok' | 'warning' | 'error' = !target.form.valid
      ? 'error'
      : !target.registrationOpen
      ? 'warning'
      : 'ok';

    // 2. Sheets evaluation
    let sheetsStatus: 'ok' | 'warning' | 'error' | 'not_configured' = 'not_configured';
    let spreadsheetId: string | undefined;
    let sheetName: string | undefined = 'Sheet1';
    let missingColumns: string[] = [];
    let foundColumns: string[] = [];
    const sheetsIssues: string[] = [];

    // Check if target has spreadsheet mapped in database
    if (this.deps.db) {
      const mapping = await this.deps.db
        .selectFrom('target_spreadsheets')
        .select(['spreadsheet_id', 'sheet_name'])
        .where('target_id', '=', targetId)
        .executeTakeFirst();

      if (mapping) {
        spreadsheetId = mapping.spreadsheet_id;
        sheetName = mapping.sheet_name || 'Sheet1';
      }
    }

    if (spreadsheetId && this.deps.spreadsheetRepo) {
      // Determine required column names from target.form.inputs
      const requiredColumns = (target.form.inputs ?? [])
        .filter((input) => input.required !== false)
        .map((input) => input.key);

      const diag = await this.deps.spreadsheetRepo.diagnose(
        spreadsheetId,
        requiredColumns,
        sheetName
      );

      if (!diag.accessible) {
        sheetsStatus = 'error';
        sheetsIssues.push(diag.error || 'No se pudo acceder a Google Sheets');
      } else if (!diag.headerDiagnostic.valid) {
        sheetsStatus = 'error';
        missingColumns = diag.headerDiagnostic.missingColumns;
        foundColumns = diag.headerDiagnostic.foundColumns;
        sheetsIssues.push(
          `Faltan columnas requeridas en la planilla: ${missingColumns.join(', ')}`
        );
      } else {
        sheetsStatus = 'ok';
        foundColumns = diag.headerDiagnostic.foundColumns;
      }
    }

    // 3. Drive evaluation
    let driveStatus: 'ok' | 'warning' | 'error' | 'not_configured' = 'not_configured';
    let targetFolderId: string | undefined;
    let documentsFolderId: string | undefined;
    const driveIssues: string[] = [];

    if (this.deps.driveRepo) {
      try {
        const folders = await this.deps.driveRepo.resolveTargetFolders(
          target.id,
          target.title
        );
        targetFolderId = folders.targetFolderId;
        documentsFolderId = folders.documentsFolderId;
        driveStatus = 'ok';
      } catch (err) {
        driveStatus = 'error';
        driveIssues.push(
          err instanceof Error
            ? err.message
            : 'Error desconocido al resolver carpetas en Google Drive'
        );
      }
    }

    // Overall status computation
    let overallStatus: 'healthy' | 'warning' | 'error' = 'healthy';
    if (wpStatus === 'error' || sheetsStatus === 'error' || driveStatus === 'error') {
      overallStatus = 'error';
    } else if (wpStatus === 'warning') {
      overallStatus = 'warning';
    }

    return {
      targetId: target.id,
      title: target.title,
      status: overallStatus,
      wordpress: {
        status: wpStatus,
        valid: target.form.valid,
        issues: wpIssues,
        configRevision: target.configRevision,
        registrationOpen: target.registrationOpen,
        inputsCount: target.form.inputs?.length ?? 0,
      },
      sheets: {
        status: sheetsStatus,
        spreadsheetId,
        sheetName,
        missingColumns,
        foundColumns,
        issues: sheetsIssues,
      },
      drive: {
        status: driveStatus,
        targetFolderId,
        documentsFolderId,
        issues: driveIssues,
      },
      checkedAt,
    };
  }

  async listErrors(filter?: FindErrorsFilter): Promise<SystemErrorRecord[]> {
    if (!this.deps.errorRepo) {
      return [];
    }
    return this.deps.errorRepo.findMany(filter);
  }

  async resolveError(
    id: string,
    resolvedBy: string,
    now: Date = new Date()
  ): Promise<SystemErrorRecord | null> {
    if (!this.deps.errorRepo) {
      return null;
    }
    return this.deps.errorRepo.resolve(id, resolvedBy, now);
  }

  async checkIntegrationsHealth(): Promise<IntegrationsHealthResult> {
    const timestamp = new Date().toISOString();

    // 1. Database check
    let dbStatus: 'healthy' | 'unhealthy' = 'healthy';
    let dbMessage: string | undefined;
    if (this.deps.checkDatabase) {
      try {
        const ok = await this.deps.checkDatabase();
        if (!ok) {
          dbStatus = 'unhealthy';
          dbMessage = 'Base de datos no responde a SELECT 1';
        }
      } catch (err) {
        dbStatus = 'unhealthy';
        dbMessage = err instanceof Error ? err.message : 'Error al conectar con la base de datos';
      }
    }

    // 2. WordPress check
    let wpStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let wpMessage: string | undefined;
    try {
      const targets = await this.deps.catalog.listTargets();
      if (targets.length === 0) {
        wpStatus = 'degraded';
        wpMessage = 'El catálogo de WordPress no retornó ofertas activas';
      }
    } catch (err) {
      wpStatus = 'unhealthy';
      wpMessage = err instanceof Error ? err.message : 'No se pudo conectar con WordPress';
    }

    // 3. Google Sheets check
    let sheetsStatus: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured' = 'not_configured';
    let sheetsMessage: string | undefined;
    if (this.deps.spreadsheetRepo) {
      sheetsStatus = 'healthy';
      sheetsMessage = 'Servicio Google Sheets configurado y disponible';
    }

    // 4. Google Drive check
    let driveStatus: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured' = 'not_configured';
    let driveMessage: string | undefined;
    if (this.deps.driveRepo) {
      driveStatus = 'healthy';
      driveMessage = 'Servicio Google Drive configurado y disponible';
    }

    // Overall status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (dbStatus === 'unhealthy' || wpStatus === 'unhealthy') {
      overallStatus = 'unhealthy';
    } else if (wpStatus === 'degraded') {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp,
      integrations: {
        database: { status: dbStatus, message: dbMessage },
        wordpress: { status: wpStatus, message: wpMessage },
        googleSheets: { status: sheetsStatus, message: sheetsMessage },
        googleDrive: { status: driveStatus, message: driveMessage },
      },
    };
  }
}
