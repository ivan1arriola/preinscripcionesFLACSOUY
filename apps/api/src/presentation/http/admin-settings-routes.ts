import { Router } from 'express';
import { z } from 'zod';
import type { SystemSettingsRepository } from '../../ports/system-settings-repository.js';
import {
  createRequireAdminSession,
  type AdminSessionStore,
  type RequestWithAdminSession,
} from '../../application/admin-session.js';
import { extractDriveFolderId, isValidDriveFolderId } from '../../domain/google-drive-utils.js';

const UpdateDriveFolderSchema = z.object({
  folderId: z.string().min(1, 'La carpeta de Google Drive es requerida'),
});

export function createAdminSettingsRoutes(
  settingsRepository: SystemSettingsRepository,
  sessionStore: AdminSessionStore,
  serviceAccountEmail?: string
): Router {
  const router = Router();
  const requireAdmin = createRequireAdminSession(sessionStore);

  router.use(requireAdmin);

  router.get('/', async (_req, res) => {
    const folderId =
      (await settingsRepository.getSetting('google_drive_folder_id')) ||
      process.env.GOOGLE_DRIVE_FOLDER_ID ||
      '1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e';

    const record = await settingsRepository.getSettingRecord('google_drive_folder_id');

    res.json({
      googleDriveFolderId: folderId,
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

    const actor = req.adminUser?.email || 'admin';
    await settingsRepository.setSetting('google_drive_folder_id', extractedId, actor);

    res.json({
      ok: true,
      googleDriveFolderId: extractedId,
    });
  });

  return router;
}
