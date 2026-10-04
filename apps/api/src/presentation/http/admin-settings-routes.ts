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
import type { EmailNotificationRepository } from '../../ports/email-notification-repository.js';
import type { EmailNotificationDispatcher } from '../../application/email-notification-dispatcher.js';
import {
  loadEmailConfig,
  maskEmail,
  maskString,
  parseMasterEmails,
  serializeMasterEmails,
  type SesCredentialsConfig,
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
import { type EmailProvider, SesEmailProvider } from '../../infrastructure/email/ses-client.js';

const UpdateDriveFolderSchema = z.object({
  folderId: z.string().min(1, 'La carpeta de Google Drive es requerida'),
});

const SendTestEmailSchema = z.object({
  recipientEmail: z.string().email('Dirección de correo destinatario inválida').optional(),
  to: z.string().email('Dirección de correo destinatario inválida').optional(),
}).refine((data) => data.recipientEmail || data.to, {
  message: 'Debe especificar recipientEmail o to con un correo válido',
});

const RetryNotificationSchema = z.object({
  force: z.boolean().optional(),
  recipientEmail: z.string().email('Dirección de correo destinatario inválida').optional(),
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
  emailNotificationRepository?: EmailNotificationRepository,
  dispatcher?: EmailNotificationDispatcher,
  emailProviderFactory?: (config: SesCredentialsConfig) => EmailProvider,
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

  router.post('/email/test', async (req: RequestWithAdminSession, res) => {
    if (!encryptedSettingsService) {
      res.status(503).json({
        error: { code: 'ENCRYPTION_UNAVAILABLE', message: 'Servicio de configuración cifrada no disponible.' },
      });
      return;
    }

    const parsed = SendTestEmailSchema.safeParse(req.body ?? {});
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

    const recipient = (parsed.data.recipientEmail || parsed.data.to)!.trim();

    try {
      const config = await loadEmailConfig(encryptedSettingsService);
      if (!config.ses) {
        res.status(400).json({
          error: {
            code: 'SES_NOT_CONFIGURED',
            message: 'Amazon SES no está completamente configurado (falta Access Key, Secret Key, Región o Remitente).',
          },
        });
        return;
      }

      const provider = emailProviderFactory ? emailProviderFactory(config.ses) : new SesEmailProvider(config.ses);
      const result = await provider.send({
        to: [recipient],
        subject: 'Prueba de configuración de Amazon SES - FLACSO Uruguay',
        text: 'Este es un mensaje de prueba enviado desde el panel de administración de FLACSO Uruguay para verificar la conectividad con Amazon SES.',
        html: '<p>Este es un mensaje de prueba enviado desde el panel de administración de <strong>FLACSO Uruguay</strong> para verificar la conectividad con Amazon SES.</p>',
        replyTo: config.ses.replyToEmail ? [config.ses.replyToEmail] : undefined,
        tags: { purpose: 'test_notification' },
      });

      res.json({
        ok: true,
        providerMessageId: result.providerMessageId,
        recipient,
      });
    } catch (error) {
      res.status(502).json({
        error: {
          code: 'SES_SEND_ERROR',
          message: error instanceof Error ? error.message : 'Error al enviar correo de prueba vía Amazon SES.',
        },
      });
    }
  });

  router.get('/notifications', async (req, res) => {
    if (!emailNotificationRepository) {
      res.status(503).json({
        error: { code: 'NOTIFICATIONS_UNAVAILABLE', message: 'Repositorio de notificaciones no disponible.' },
      });
      return;
    }

    const statusParam = req.query.status as string | undefined;
    const limitParam = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
    const offsetParam = req.query.offset ? Math.max(Number(req.query.offset), 0) : 0;

    let counts = { pending: 0, processing: 0, sent: 0, failed: 0, unknown: 0, total: 0 };
    if (emailNotificationRepository.getCounts) {
      counts = await emailNotificationRepository.getCounts();
    } else if (emailNotificationRepository.listNotifications) {
      const all = await emailNotificationRepository.listNotifications({ limit: 1000 });
      for (const item of all) {
        if (item.status in counts) {
          counts[item.status as keyof typeof counts]++;
          counts.total++;
        }
      }
    }

    const validStatuses = ['pending', 'processing', 'sent', 'failed', 'unknown'];
    const statusFilter = statusParam && validStatuses.includes(statusParam) ? (statusParam as any) : undefined;

    const list = emailNotificationRepository.listNotifications
      ? await emailNotificationRepository.listNotifications({
          status: statusFilter,
          limit: limitParam,
          offset: offsetParam,
        })
      : [];

    res.json({
      ok: true,
      counts,
      notifications: list.map((item) => ({
        id: item.id,
        submissionId: item.submissionId,
        audience: item.audience,
        recipientEmail: item.recipientEmail,
        targetId: item.targetId,
        status: item.status,
        attemptCount: item.attemptCount,
        providerMessageId: item.providerMessageId ?? null,
        lastError: item.lastError ?? null,
        availableAt: item.availableAt,
        lockedUntil: item.lockedUntil ?? null,
        sentAt: item.sentAt ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  });

  router.post('/notifications/:id/retry', async (req: RequestWithAdminSession, res) => {
    if (!emailNotificationRepository) {
      res.status(503).json({
        error: { code: 'NOTIFICATIONS_UNAVAILABLE', message: 'Repositorio de notificaciones no disponible.' },
      });
      return;
    }

    const id = String(req.params.id);
    if (!id) {
      res.status(400).json({ error: { code: 'INVALID_ID', message: 'ID inválido' } });
      return;
    }
    const parsed = RetryNotificationSchema.safeParse(req.body ?? {});
    const force = parsed.success ? Boolean(parsed.data.force) : false;

    const notification = emailNotificationRepository.findById
      ? await emailNotificationRepository.findById(id)
      : null;

    if (!notification) {
      res.status(404).json({
        error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notificación no encontrada.' },
      });
      return;
    }

    if (notification.status === 'sent') {
      res.status(400).json({
        error: { code: 'INVALID_STATUS', message: 'No se puede reintentar una notificación ya enviada exitosamente.' },
      });
      return;
    }

    if (notification.status === 'processing') {
      res.status(400).json({
        error: { code: 'INVALID_STATUS', message: 'La notificación ya se encuentra en procesamiento.' },
      });
      return;
    }

    if (notification.status === 'unknown' && !force) {
      res.status(400).json({
        error: {
          code: 'UNKNOWN_STATUS_REQUIRES_CONFIRMATION',
          message:
            'El envío anterior quedó en estado desconocido y podría haber sido entregado. Confirme el reintento explícitamente para evitar duplicados.',
        },
      });
      return;
    }

    const recipientEmail = parsed.success && parsed.data.recipientEmail ? parsed.data.recipientEmail.trim().toLowerCase() : undefined;

    if (emailNotificationRepository.resetForManualRetry) {
      await emailNotificationRepository.resetForManualRetry(id, new Date(), recipientEmail);
    }

    res.json({
      ok: true,
      message: 'Notificación reencolada para nuevo intento.',
      recipientEmail: recipientEmail ?? notification.recipientEmail,
    });
  });

  router.post('/notifications/dispatch', async (_req, res) => {
    if (!dispatcher) {
      res.status(503).json({
        error: { code: 'DISPATCHER_UNAVAILABLE', message: 'Dispatcher de notificaciones no configurado.' },
      });
      return;
    }

    try {
      const result = await dispatcher.processPendingBatch();
      res.json({
        ok: true,
        claimed: result.claimed,
        processed: result.processed,
        sent: result.sent,
        failed: result.failed,
        failedPermanent: result.failedPermanent,
        failedRetryable: result.failedRetryable,
        unknown: result.unknown,
      });
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'DISPATCH_ERROR',
          message: error instanceof Error ? error.message : 'Error al procesar la cola de notificaciones.',
        },
      });
    }
  });

  return router;
}
