import { Router } from 'express';
import { z } from 'zod';
import type { SystemSettingsRepository } from '../../ports/system-settings-repository.js';
import {
  createRequireAdminSession,
  type AdminSessionStore,
  type RequestWithAdminSession,
} from '../../application/admin-session.js';
import { extractDriveFolderId, isValidDriveFolderId } from '../../domain/google-drive-utils.js';
import type { GoogleDriveFolderInfo } from '../../ports/google-drive-repository.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import { canProvisionTargetSpreadsheet, type TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';
import type { TargetSpreadsheetRepository } from '../../ports/target-spreadsheet-repository.js';

const UpdateDriveFolderSchema = z.object({
  folderId: z.string().min(1, 'La carpeta de Google Drive es requerida'),
});

export function createAdminSettingsRoutes(
  settingsRepository: SystemSettingsRepository,
  sessionStore: AdminSessionStore,
  serviceAccountEmail?: string,
  driveConfiguration?: { inspectFolder(folderId: string): Promise<GoogleDriveFolderInfo> },
  catalog?: AcademicCatalog,
  targetSpreadsheetService?: TargetSpreadsheetService,
  targetSpreadsheetRepository?: TargetSpreadsheetRepository,
): Router {
  const router = Router();
  const requireAdmin = createRequireAdminSession(sessionStore);

  router.use(requireAdmin);

  router.get('/', async (_req, res) => {
    const folderId = await settingsRepository.getSetting('google_drive_folder_id');
    let folderName: string | null = null;
    let canAddChildren = false;
    if (folderId && driveConfiguration) {
      try {
        const folder = await driveConfiguration.inspectFolder(folderId);
        folderName = folder.name;
        canAddChildren = folder.canAddChildren;
      } catch {
        // The admin UI still receives the stored ID and can replace it.
      }
    }

    const record = await settingsRepository.getSettingRecord('google_drive_folder_id');

    res.json({
      googleDriveFolderId: folderId,
      googleDriveFolderName: folderName,
      googleDriveCanAddChildren: canAddChildren,
      serviceAccountEmail: serviceAccountEmail || null,
      updatedAt: record?.updatedAt ?? null,
      updatedBy: record?.updatedBy ?? null,
    });
  });

  router.put('/google-drive', async (req: RequestWithAdminSession, res) => {
    const parsed = UpdateDriveFolderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Datos inválidos',
          issues: parsed.error.issues,
        },
      });
      return;
    }

    const extractedId = extractDriveFolderId(parsed.data.folderId);
    if (!isValidDriveFolderId(extractedId)) {
      res.status(400).json({
        error: {
          code: 'INVALID_FOLDER_ID',
          message:
            'El ID o enlace de la carpeta de Google Drive no tiene un formato válido (debe tener entre 10 y 100 caracteres alfanuméricos).',
        },
      });
      return;
    }

    if (!driveConfiguration) {
      res.status(503).json({
        error: { code: 'DRIVE_CONFIGURATION_UNAVAILABLE', message: 'No se puede comprobar la carpeta de Google Drive en este momento.' },
      });
      return;
    }

    let folder: GoogleDriveFolderInfo;
    try {
      folder = await driveConfiguration.inspectFolder(extractedId);
    } catch (error) {
      res.status(502).json({
        error: { code: 'DRIVE_FOLDER_UNAVAILABLE', message: error instanceof Error ? error.message : 'No se pudo comprobar la carpeta de Google Drive.' },
      });
      return;
    }
    if (!folder.canAddChildren) {
      res.status(403).json({
        error: { code: 'DRIVE_FOLDER_READ_ONLY', message: 'La cuenta de servicio puede leer la carpeta, pero no puede crear archivos o subcarpetas en ella.' },
      });
      return;
    }

    const actor = req.adminUser?.email || 'admin';
    await settingsRepository.setSetting('google_drive_folder_id', extractedId, actor);

    let reconciliationResult: any = undefined;
    let ok = true;
    if (catalog && targetSpreadsheetService) {
      const targets = (await catalog.listTargets()).filter(canProvisionTargetSpreadsheet);
      reconciliationResult = await targetSpreadsheetService.reconcileTargets(targets);
      ok = reconciliationResult.status === 'completed';
    }

    res.json({
      ok,
      googleDriveFolderId: extractedId,
      googleDriveFolderName: folder.name,
      googleDriveCanAddChildren: folder.canAddChildren,
      ...(reconciliationResult ? { reconciliation: reconciliationResult } : {}),
    });
  });

  router.get('/spreadsheets', async (_req, res) => {
    if (!catalog || !targetSpreadsheetRepository) {
      res.status(503).json({ error: { code: 'SPREADSHEET_CONFIGURATION_UNAVAILABLE', message: 'La configuración de planillas no está disponible.' } });
      return;
    }
    const targets = (await catalog.listTargets()).filter(canProvisionTargetSpreadsheet);
    const configurations = await targetSpreadsheetRepository.list();
    const byTargetId = new Map(configurations.map((configuration) => [configuration.targetId, configuration]));
    res.json({
      targets: targets.map((target) => ({
        targetId: target.id,
        title: target.title,
        kind: target.kind,
        spreadsheet: byTargetId.get(target.id) ?? null,
      })),
    });
  });

  router.post('/spreadsheets/provision', async (_req, res) => {
    if (!catalog || !targetSpreadsheetService) {
      res.status(503).json({ error: { code: 'SPREADSHEET_PROVISIONING_UNAVAILABLE', message: 'La creación automática de planillas no está disponible.' } });
      return;
    }
    try {
      const targets = (await catalog.listTargets()).filter(canProvisionTargetSpreadsheet);
      const reconciliation = await targetSpreadsheetService.reconcileTargets(targets);
      const configurations = await targetSpreadsheetService.ensureForTargets(targets);
      res.json({
        ok: reconciliation.status === 'completed',
        spreadsheets: configurations,
        reconciliation,
      });
    } catch (error) {
      res.status(502).json({
        error: {
          code: 'SPREADSHEET_PROVISIONING_ERROR',
          message: error instanceof Error ? error.message : 'No se pudieron crear las planillas automáticamente.',
        },
      });
    }
  });

  return router;
}
