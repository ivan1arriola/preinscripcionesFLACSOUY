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
import type { EncryptedSettingsService } from '../../infrastructure/security/encrypted-settings.js';
import {
  maskEmail,
  maskString,
  parseMasterEmails,
  serializeMasterEmails,
  SETTING_EMAIL_NOTIFICATIONS_ENABLED,
  SETTING_NOTIFICATION_MASTER_EMAILS,
  SETTING_SES_AWS_ACCESS_KEY_ID,
  SETTING_SES_AWS_SECRET_ACCESS_KEY,
  SETTING_SES_AWS_SESSION_TOKEN,
  SETTING_SES_REGION,
  SETTING_SES_FROM_EMAIL,
  SETTING_SES_REPLY_TO_EMAIL,
  SETTING_SES_CONFIGURATION_SET,
} from '../../infrastructure/email/email-config.js';

const UpdateDriveFolderSchema = z.object({
  folderId: z.string().min(1, 'La carpeta de Google Drive es requerida'),
});

const UpdateEmailSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  masterEmails: z.array(z.string().email('Formato de correo inválido')).optional(),
  awsAccessKeyId: z.string().min(1).optional(),
  awsSecretAccessKey: z.string().min(1).optional(),
  awsSessionToken: z.string().nullable().optional(),
  region: z.string().min(1).optional(),
  fromEmail: z.string().email('Formato de correo remitente inválido').optional(),
  replyToEmail: z.string().email('Formato de correo reply-to inválido').nullable().optional(),
  configurationSet: z.string().nullable().optional(),
  ses: z
    .object({
      accessKeyId: z.string().min(1).optional(),
      secretAccessKey: z.string().min(1).optional(),
      sessionToken: z.string().nullable().optional(),
      region: z.string().min(1).optional(),
      fromEmail: z.string().email('Formato de correo remitente inválido').optional(),
      replyToEmail: z.string().email('Formato de correo reply-to inválido').nullable().optional(),
      configurationSet: z.string().nullable().optional(),
    })
    .optional(),
});

export function createAdminSettingsRoutes(
  settingsRepository: SystemSettingsRepository,
  sessionStore: AdminSessionStore,
  serviceAccountEmail?: string,
  driveConfiguration?: { inspectFolder(folderId: string): Promise<GoogleDriveFolderInfo> },
  catalog?: AcademicCatalog,
  targetSpreadsheetService?: TargetSpreadsheetService,
  targetSpreadsheetRepository?: TargetSpreadsheetRepository,
  encryptedSettingsService?: EncryptedSettingsService,
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

  router.get('/email', async (_req, res) => {
    if (!encryptedSettingsService) {
      res.status(503).json({
        error: {
          code: 'ENCRYPTION_UNAVAILABLE',
          message: 'El servicio de cifrado no está disponible.',
        },
      });
      return;
    }

    try {
      const enabled = (await encryptedSettingsService.getEncryptedSetting(SETTING_EMAIL_NOTIFICATIONS_ENABLED)) === 'true';
      const rawMasters = await encryptedSettingsService.getEncryptedSetting(SETTING_NOTIFICATION_MASTER_EMAILS);
      const masterEmails = parseMasterEmails(rawMasters);

      const accessKeyId = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_AWS_ACCESS_KEY_ID);
      const secretAccessKey = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_AWS_SECRET_ACCESS_KEY);
      const sessionToken = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_AWS_SESSION_TOKEN);
      const region = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_REGION);
      const fromEmail = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_FROM_EMAIL);
      const replyToEmail = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_REPLY_TO_EMAIL);
      const configurationSet = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_CONFIGURATION_SET);

      const hasAccessKey = Boolean(accessKeyId);
      const hasSecretKey = Boolean(secretAccessKey);
      const hasSessionToken = Boolean(sessionToken);
      const isConfigured = Boolean(accessKeyId && secretAccessKey && region && fromEmail);
      const fromEmailMasked = fromEmail ? maskEmail(fromEmail) : null;
      const replyToEmailMasked = replyToEmail ? maskEmail(replyToEmail) : null;
      const accessKeyIdMasked = accessKeyId ? maskString(accessKeyId) : null;

      const record = await settingsRepository.getSettingRecord(SETTING_SES_AWS_ACCESS_KEY_ID);

      res.json({
        ok: true,
        enabled,
        configured: isConfigured,
        region: region || null,
        fromEmailMasked,
        replyToEmailMasked,
        accessKeyIdMasked,
        configurationSet: configurationSet || null,
        ses: {
          configured: isConfigured,
          hasAccessKey,
          hasSecretKey,
          hasSessionToken,
          region: region || null,
          fromEmail: fromEmailMasked,
          replyToEmail: replyToEmailMasked,
          configurationSet: configurationSet || null,
        },
        masterEmails,
        updatedAt: record?.updatedAt ?? null,
        updatedBy: record?.updatedBy ?? null,
      });
    } catch (error) {
      res.status(503).json({
        error: {
          code: 'ENCRYPTION_ERROR',
          message: error instanceof Error ? error.message : 'Error al leer la configuración de correo.',
        },
      });
    }
  });

  router.put('/email', async (req: RequestWithAdminSession, res) => {
    if (!encryptedSettingsService) {
      res.status(503).json({
        error: {
          code: 'ENCRYPTION_UNAVAILABLE',
          message: 'El servicio de cifrado no está disponible.',
        },
      });
      return;
    }

    const parsed = UpdateEmailSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Datos de configuración de correo inválidos.',
          issues: parsed.error.issues,
        },
      });
      return;
    }

    const actor = req.adminUser?.email || 'admin';
    const { enabled, masterEmails } = parsed.data;

    const accessKeyToSet = parsed.data.awsAccessKeyId ?? parsed.data.ses?.accessKeyId;
    const secretKeyToSet = parsed.data.awsSecretAccessKey ?? parsed.data.ses?.secretAccessKey;
    const sessionTokenToSet = parsed.data.awsSessionToken !== undefined ? parsed.data.awsSessionToken : parsed.data.ses?.sessionToken;
    const regionToSet = parsed.data.region ?? parsed.data.ses?.region;
    const fromEmailToSet = parsed.data.fromEmail ?? parsed.data.ses?.fromEmail;
    const replyToEmailToSet = parsed.data.replyToEmail !== undefined ? parsed.data.replyToEmail : parsed.data.ses?.replyToEmail;
    const configSetToSet = parsed.data.configurationSet !== undefined ? parsed.data.configurationSet : parsed.data.ses?.configurationSet;

    try {
      if (typeof enabled === 'boolean') {
        await encryptedSettingsService.setEncryptedSetting(
          SETTING_EMAIL_NOTIFICATIONS_ENABLED,
          enabled ? 'true' : 'false',
          actor
        );
      }

      if (masterEmails !== undefined) {
        await encryptedSettingsService.setEncryptedSetting(
          SETTING_NOTIFICATION_MASTER_EMAILS,
          serializeMasterEmails(masterEmails),
          actor
        );
      }

      if (accessKeyToSet !== undefined) {
        await encryptedSettingsService.setEncryptedSetting(SETTING_SES_AWS_ACCESS_KEY_ID, accessKeyToSet.trim(), actor);
      }
      if (secretKeyToSet !== undefined) {
        await encryptedSettingsService.setEncryptedSetting(SETTING_SES_AWS_SECRET_ACCESS_KEY, secretKeyToSet.trim(), actor);
      }
      if (sessionTokenToSet !== undefined) {
        if (sessionTokenToSet === null || sessionTokenToSet.trim() === '') {
          await encryptedSettingsService.setEncryptedSetting(SETTING_SES_AWS_SESSION_TOKEN, '', actor);
        } else {
          await encryptedSettingsService.setEncryptedSetting(SETTING_SES_AWS_SESSION_TOKEN, sessionTokenToSet.trim(), actor);
        }
      }
      if (regionToSet !== undefined) {
        await encryptedSettingsService.setEncryptedSetting(SETTING_SES_REGION, regionToSet.trim(), actor);
      }
      if (fromEmailToSet !== undefined) {
        await encryptedSettingsService.setEncryptedSetting(SETTING_SES_FROM_EMAIL, fromEmailToSet.trim(), actor);
      }
      if (replyToEmailToSet !== undefined) {
        if (replyToEmailToSet === null || replyToEmailToSet.trim() === '') {
          await encryptedSettingsService.setEncryptedSetting(SETTING_SES_REPLY_TO_EMAIL, '', actor);
        } else {
          await encryptedSettingsService.setEncryptedSetting(SETTING_SES_REPLY_TO_EMAIL, replyToEmailToSet.trim(), actor);
        }
      }
      if (configSetToSet !== undefined) {
        if (configSetToSet === null || configSetToSet.trim() === '') {
          await encryptedSettingsService.setEncryptedSetting(SETTING_SES_CONFIGURATION_SET, '', actor);
        } else {
          await encryptedSettingsService.setEncryptedSetting(SETTING_SES_CONFIGURATION_SET, configSetToSet.trim(), actor);
        }
      }

      const updatedEnabled = (await encryptedSettingsService.getEncryptedSetting(SETTING_EMAIL_NOTIFICATIONS_ENABLED)) === 'true';
      const rawMasters = await encryptedSettingsService.getEncryptedSetting(SETTING_NOTIFICATION_MASTER_EMAILS);
      const updatedMasterEmails = parseMasterEmails(rawMasters);

      const accessKeyId = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_AWS_ACCESS_KEY_ID);
      const secretAccessKey = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_AWS_SECRET_ACCESS_KEY);
      const sessionToken = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_AWS_SESSION_TOKEN);
      const region = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_REGION);
      const fromEmail = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_FROM_EMAIL);
      const replyToEmail = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_REPLY_TO_EMAIL);
      const configurationSet = await encryptedSettingsService.getEncryptedSetting(SETTING_SES_CONFIGURATION_SET);

      const isConfigured = Boolean(accessKeyId && secretAccessKey && region && fromEmail);
      const fromEmailMasked = fromEmail ? maskEmail(fromEmail) : null;
      const replyToEmailMasked = replyToEmail ? maskEmail(replyToEmail) : null;
      const accessKeyIdMasked = accessKeyId ? maskString(accessKeyId) : null;

      res.json({
        ok: true,
        enabled: updatedEnabled,
        configured: isConfigured,
        region: region || null,
        fromEmailMasked,
        replyToEmailMasked,
        accessKeyIdMasked,
        configurationSet: configurationSet || null,
        ses: {
          configured: isConfigured,
          hasAccessKey: Boolean(accessKeyId),
          hasSecretKey: Boolean(secretAccessKey),
          hasSessionToken: Boolean(sessionToken),
          region: region || null,
          fromEmail: fromEmailMasked,
          replyToEmail: replyToEmailMasked,
          configurationSet: configurationSet || null,
        },
        masterEmails: updatedMasterEmails,
      });
    } catch (error) {
      res.status(503).json({
        error: {
          code: 'ENCRYPTION_ERROR',
          message: error instanceof Error ? error.message : 'Error al guardar la configuración de correo.',
        },
      });
    }
  });

  return router;
}
