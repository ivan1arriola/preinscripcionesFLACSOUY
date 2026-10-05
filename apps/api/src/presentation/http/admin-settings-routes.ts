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
  serializeMasterEmails,
  invalidateSmtpVerificationStatus,
  safeSmtpVerificationError,
  isMaskedEmail,
  isValidEmailOrMasked,
  SETTING_EMAIL_NOTIFICATIONS_ENABLED,
  SETTING_EMAIL_PROVIDER,
  SETTING_NOTIFICATION_MASTER_EMAILS,
  SETTING_SMTP_HOST,
  SETTING_SMTP_PORT,
  SETTING_SMTP_SECURITY,
  SETTING_SMTP_USERNAME,
  SETTING_SMTP_PASSWORD,
  SETTING_EMAIL_FROM,
  SETTING_EMAIL_REPLY_TO,
  SETTING_SMTP_LAST_CONNECTION_TEST_AT,
  SETTING_SMTP_LAST_CONNECTION_TEST_OK,
  SETTING_SMTP_LAST_CONNECTION_TEST_ERROR,
} from '../../infrastructure/email/email-config.js';
import { type EmailProvider } from '../../infrastructure/email/email-provider.js';
import { SmtpEmailProvider } from '../../infrastructure/email/smtp-email-provider.js';
import type {
  SubmissionRecoveryRepository,
  RecoveryStage,
  RecoveryStatus,
} from '../../ports/submission-recovery-repository.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import { retryFailedSubmission } from '../../application/retry-failed-submission.js';
import {
  loadTelegramConfig,
  saveTelegramConfig,
  maskTelegramConfig,
  maskChatId,
  SETTING_TELEGRAM_LAST_TESTED_AT,
  SETTING_TELEGRAM_LAST_TEST_STATUS,
  SETTING_TELEGRAM_LAST_TEST_ERROR,
} from '../../infrastructure/telegram/telegram-config.js';
import type { TelegramProvider } from '../../ports/telegram-provider.js';
import type { TelegramAlertRepository } from '../../ports/telegram-alert-repository.js';
import { FetchTelegramProvider } from '../../infrastructure/telegram/telegram-provider.js';

const UpdateDriveFolderSchema = z.object({
  folderId: z.string().min(1, 'La carpeta de Google Drive es requerida'),
});
const UnlinkSpreadsheetSchema = z.object({ targetId: z.string().min(1) });

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

const UpdateEmailSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    masterEmails: z.array(z.string().email('Formato de correo inválido')).optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    security: z.enum(['starttls', 'tls']).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    replacePassword: z.boolean().optional(),
    fromEmail: z.string().optional(),
    replyToEmail: z.string().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.replacePassword && !value.password) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'Ingresá la nueva contraseña SMTP.' });
    }
    if (value.fromEmail !== undefined && value.fromEmail !== '') {
      const trimmed = value.fromEmail.trim();
      if (!isValidEmailOrMasked(trimmed)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fromEmail'],
          message: 'El remitente debe ser una dirección de correo válida.',
        });
      }
    }
    if (value.replyToEmail !== undefined && value.replyToEmail !== null && value.replyToEmail !== '') {
      const trimmed = value.replyToEmail.trim();
      if (!isValidEmailOrMasked(trimmed)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['replyToEmail'],
          message: 'La dirección de respuesta (reply-to) debe ser un correo válido.',
        });
      }
    }
  });

const ListRecoveriesQuerySchema = z.object({
  status: z.string().optional(),
  stage: z.enum(['drive', 'sheets', 'notifications', 'unknown']).optional(),
  targetId: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const DiscardRecoverySchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .optional();

const UpdateTelegramSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    preinscriptionEnabled: z.boolean().optional(),
    botToken: z.string().optional(),
    replaceToken: z.boolean().optional(),
    chatIds: z.array(z.string()).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.replaceToken && (!val.botToken || !val.botToken.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['botToken'],
        message: 'Ingresá el nuevo token de Telegram.',
      });
    }
    if (val.botToken && val.botToken.trim()) {
      if (!/^[0-9]+:[a-zA-Z0-9_\-]+$/.test(val.botToken.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['botToken'],
          message: 'El token de Telegram no tiene el formato esperado (ej. 123456789:ABCdef...).',
        });
      }
    }
    if (val.chatIds) {
      for (let i = 0; i < val.chatIds.length; i++) {
        const id = val.chatIds[i]!.trim();
        if (!id || !/^-?[0-9]+$/.test(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['chatIds', i],
            message: `El chat ID "${val.chatIds[i]}" no es válido (debe ser numérico, ej. 123456789 o -100123456789).`,
          });
        }
      }
    }
  });

const SendTestTelegramSchema = z.object({
  chatId: z.string().regex(/^-?[0-9]+$/, 'El identificador de chat debe ser numérico').optional(),
});

function sanitizeTelegramError(raw: string): string {
  let sanitized = raw.replace(/([?&](key|token|secret|password|access_token)=)[^&]+/gi, '$1***');
  sanitized = sanitized.replace(/\/bot[0-9]+:[a-zA-Z0-9_\-]+/g, '/bot[REDACTED_TOKEN]');
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 497) + '...';
  }
  return sanitized;
}

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
  emailProviderFactory?: (config: NonNullable<Awaited<ReturnType<typeof loadEmailConfig>>['smtp']>) => EmailProvider,
  submissionRecoveryRepository?: SubmissionRecoveryRepository,
  submissionRepository?: SubmissionRepository,
  temporaryFileStorage?: TemporaryFileStoragePort,
  googleDriveRepository?: GoogleDriveRepositoryPort,
  spreadsheetRepository?: SpreadsheetRepository,
  telegramProviderFactory?: (botToken: string) => TelegramProvider,
  telegramAlertRepository?: TelegramAlertRepository,
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

  router.post('/spreadsheets/unlink', async (req, res) => {
    if (!targetSpreadsheetService) {
      res.status(503).json({ error: { code: 'SPREADSHEET_PROVISIONING_UNAVAILABLE', message: 'La gestión de planillas no está disponible.' } });
      return;
    }
    const parsed = UnlinkSpreadsheetSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Debe especificarse el destino de la planilla.' } });
      return;
    }
    try {
      const spreadsheet = await targetSpreadsheetService.unlinkForTarget(parsed.data.targetId);
      res.json({ ok: true, spreadsheet, message: 'La planilla quedó desvinculada. El archivo se conserva en Google Drive.' });
    } catch (error) {
      const status = (error as any)?.code === 'SPREADSHEET_NOT_FOUND' ? 404 : 502;
      res.status(status).json({ error: { code: (error as any)?.code || 'SPREADSHEET_UNLINK_ERROR', message: error instanceof Error ? error.message : 'No se pudo desvincular la planilla.' } });
    }
  });

  const emailSettingsResponse = async () => {
    const config = await loadEmailConfig(encryptedSettingsService!);
    const [host, port, security, username, password, fromEmail, replyToEmail, verifiedAt, verifiedOk, verificationError] = await Promise.all([
      encryptedSettingsService!.getEncryptedSetting(SETTING_SMTP_HOST), encryptedSettingsService!.getEncryptedSetting(SETTING_SMTP_PORT), encryptedSettingsService!.getEncryptedSetting(SETTING_SMTP_SECURITY), encryptedSettingsService!.getEncryptedSetting(SETTING_SMTP_USERNAME), encryptedSettingsService!.getEncryptedSetting(SETTING_SMTP_PASSWORD), encryptedSettingsService!.getEncryptedSetting(SETTING_EMAIL_FROM), encryptedSettingsService!.getEncryptedSetting(SETTING_EMAIL_REPLY_TO), encryptedSettingsService!.getEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_AT), encryptedSettingsService!.getEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_OK), encryptedSettingsService!.getEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_ERROR),
    ]);
    const record = await settingsRepository.getSettingRecord(SETTING_SMTP_HOST);
    return { ok: true, enabled: config.enabled, configured: Boolean(config.smtp), provider: 'smtp', smtp: { host: host ?? '', port: Number(port || 587), security: security === 'tls' ? 'tls' : 'starttls', username: username ?? '', hasPassword: Boolean(password), fromEmail: fromEmail ? maskEmail(fromEmail) : null, replyToEmail: replyToEmail ? maskEmail(replyToEmail) : null }, masterEmails: config.masterEmails, status: { lastConnectionTestAt: verifiedAt || null, lastConnectionTestOk: verifiedOk === '' || verifiedOk === null ? null : verifiedOk === 'true', lastConnectionTestError: verificationError || null }, updatedAt: record?.updatedAt ?? null, updatedBy: record?.updatedBy ?? null };
  };

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
      res.json(await emailSettingsResponse());
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
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue?.path[0] ? String(firstIssue.path[0]) : undefined;
      let reason = firstIssue?.message || 'Datos de configuración de correo inválidos.';
      let action = 'Verifique los campos ingresados.';

      if (field === 'fromEmail') {
        reason = 'El remitente debe ser una dirección de correo válida.';
        action = 'Verifique el formato del remitente (ej. notificaciones@flacso.edu.uy).';
      } else if (field === 'replyToEmail') {
        reason = 'La dirección de respuesta (reply-to) debe ser un correo válido.';
        action = 'Verifique el formato o deje el campo vacío si no desea configurar reply-to.';
      } else if (field === 'host') {
        reason = 'El servidor SMTP no puede estar vacío.';
        action = 'Ingrese el host o nombre de dominio del servidor SMTP (ej. smtp.flacso.edu.uy).';
      }

      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: reason,
          field,
          reason,
          action,
          issues: parsed.error.issues,
        },
      });
      return;
    }

    const actor = req.adminUser?.email || 'admin';
    const { enabled, masterEmails } = parsed.data;

    try {
      if (typeof enabled === 'boolean') {
        await encryptedSettingsService.setEncryptedSetting(
          SETTING_EMAIL_NOTIFICATIONS_ENABLED,
          enabled ? 'true' : 'false',
          actor
        );
      }

      await encryptedSettingsService.setEncryptedSetting(SETTING_EMAIL_PROVIDER, 'smtp', actor);

      if (masterEmails !== undefined) {
        await encryptedSettingsService.setEncryptedSetting(
          SETTING_NOTIFICATION_MASTER_EMAILS,
          serializeMasterEmails(masterEmails),
          actor
        );
      }

      const fields: Array<[string, string | undefined]> = [
        [SETTING_SMTP_HOST, parsed.data.host],
        [SETTING_SMTP_PORT, parsed.data.port?.toString()],
        [SETTING_SMTP_SECURITY, parsed.data.security],
        [SETTING_SMTP_USERNAME, parsed.data.username],
      ];
      for (const [key, value] of fields) {
        if (value !== undefined) await encryptedSettingsService.setEncryptedSetting(key, value.trim(), actor);
      }

      if (parsed.data.fromEmail !== undefined) {
        const trimmed = parsed.data.fromEmail.trim();
        if (trimmed && !isMaskedEmail(trimmed)) {
          await encryptedSettingsService.setEncryptedSetting(SETTING_EMAIL_FROM, trimmed.toLowerCase(), actor);
        }
      }

      if (parsed.data.replyToEmail !== undefined) {
        if (parsed.data.replyToEmail === null || parsed.data.replyToEmail.trim() === '') {
          await encryptedSettingsService.setEncryptedSetting(SETTING_EMAIL_REPLY_TO, '', actor);
        } else {
          const trimmed = parsed.data.replyToEmail.trim();
          if (trimmed && !isMaskedEmail(trimmed)) {
            await encryptedSettingsService.setEncryptedSetting(SETTING_EMAIL_REPLY_TO, trimmed.toLowerCase(), actor);
          }
        }
      }

      if (parsed.data.replacePassword && parsed.data.password) {
        await encryptedSettingsService.setEncryptedSetting(SETTING_SMTP_PASSWORD, parsed.data.password.trim(), actor);
      }
      if (parsed.data.host !== undefined || parsed.data.port !== undefined || parsed.data.security !== undefined || parsed.data.username !== undefined || parsed.data.password !== undefined) {
        await invalidateSmtpVerificationStatus(encryptedSettingsService, actor);
      }
      res.json(await emailSettingsResponse());
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
      if (!config.smtp) {
        res.status(400).json({
          error: {
            code: 'SMTP_NOT_CONFIGURED',
            message: 'SMTP no está completamente configurado.',
          },
        });
        return;
      }

      const provider = emailProviderFactory ? emailProviderFactory(config.smtp) : new SmtpEmailProvider(config.smtp);
      const result = await provider.send({
        to: [recipient],
        subject: 'Prueba de correo SMTP - FLACSO Uruguay',
        text: 'Este es un mensaje de prueba enviado desde el panel de administración de FLACSO Uruguay para verificar la conexión SMTP.',
        html: '<p>Este es un mensaje de prueba enviado desde el panel de administración de <strong>FLACSO Uruguay</strong> para verificar la conexión SMTP.</p>',
        replyTo: config.smtp.replyToEmail ? [config.smtp.replyToEmail] : undefined,
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
          code: 'SMTP_SEND_ERROR',
          message: 'No se pudo enviar el correo de prueba SMTP.',
        },
      });
    }
  });

  router.post('/email/verify', async (_req: RequestWithAdminSession, res) => {
    if (!encryptedSettingsService) {
      res.status(503).json({ error: { code: 'ENCRYPTION_UNAVAILABLE', message: 'Servicio de configuración cifrada no disponible.' } });
      return;
    }
    const actor = _req.adminUser?.email || 'admin';
    try {
      const config = await loadEmailConfig(encryptedSettingsService);
      if (!config.smtp) {
        res.status(400).json({ error: { code: 'SMTP_NOT_CONFIGURED', message: 'SMTP no está completamente configurado.' } });
        return;
      }
      const provider = emailProviderFactory ? emailProviderFactory(config.smtp) : new SmtpEmailProvider(config.smtp);
      await provider.verify();
      await encryptedSettingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_AT, new Date().toISOString(), actor);
      await encryptedSettingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_OK, 'true', actor);
      await encryptedSettingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_ERROR, '', actor);
      res.json({ ok: true });
    } catch (error) {
      await encryptedSettingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_AT, new Date().toISOString(), actor);
      await encryptedSettingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_OK, 'false', actor);
      await encryptedSettingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_ERROR, safeSmtpVerificationError(error), actor);
      res.status(502).json({ error: { code: 'SMTP_VERIFY_ERROR', message: 'No se pudo verificar la conexión SMTP.' } });
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

  // --- Telegram routes ---
  router.get('/telegram', async (_req, res) => {
    if (!encryptedSettingsService) {
      res.status(503).json({
        error: { code: 'SETTINGS_UNAVAILABLE', message: 'Servicio de configuración no disponible.' },
      });
      return;
    }

    try {
      const config = await loadTelegramConfig(encryptedSettingsService);
      res.json({
        telegram: maskTelegramConfig(config),
      });
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'SETTINGS_ERROR',
          message: error instanceof Error ? error.message : 'Error al obtener configuración de Telegram.',
        },
      });
    }
  });

  router.put('/telegram', async (req: RequestWithAdminSession, res) => {
    if (!encryptedSettingsService) {
      res.status(503).json({
        error: { code: 'SETTINGS_UNAVAILABLE', message: 'Servicio de configuración no disponible.' },
      });
      return;
    }

    const parsed = UpdateTelegramSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Datos de configuración de Telegram inválidos.',
          issues: parsed.error.issues,
        },
      });
      return;
    }

    const actor = req.adminUser?.email || 'admin';
    let tokenToSave: string | undefined = undefined;
    if (parsed.data.botToken && parsed.data.botToken.trim()) {
      tokenToSave = parsed.data.botToken.trim();
    }

    try {
      await saveTelegramConfig(
        encryptedSettingsService,
        {
          enabled: parsed.data.enabled,
          preinscriptionEnabled: parsed.data.preinscriptionEnabled,
          botToken: tokenToSave,
          chatIds: parsed.data.chatIds,
        },
        actor
      );

      const updated = await loadTelegramConfig(encryptedSettingsService);
      res.json({
        ok: true,
        message: 'Configuración de Telegram guardada correctamente.',
        telegram: maskTelegramConfig(updated),
      });
    } catch (error) {
      res.status(400).json({
        error: {
          code: 'INVALID_TELEGRAM_CONFIG',
          message: error instanceof Error ? error.message : 'Error al guardar configuración de Telegram.',
        },
      });
    }
  });

  router.post('/telegram/test', async (req: RequestWithAdminSession, res) => {
    if (!encryptedSettingsService) {
      res.status(503).json({
        error: { code: 'SETTINGS_UNAVAILABLE', message: 'Servicio de configuración no disponible.' },
      });
      return;
    }

    const parsed = SendTestTelegramSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Datos de prueba inválidos.',
          issues: parsed.error.issues,
        },
      });
      return;
    }

    const config = await loadTelegramConfig(encryptedSettingsService);
    if (!config.botToken) {
      res.status(400).json({
        error: {
          code: 'TELEGRAM_TOKEN_MISSING',
          message: 'No hay un token de bot configurado para enviar la prueba.',
        },
      });
      return;
    }

    const targetChatId = parsed.data.chatId ?? (config.chatIds.length > 0 ? config.chatIds[0] : undefined);
    if (!targetChatId) {
      res.status(400).json({
        error: {
          code: 'TELEGRAM_CHAT_ID_MISSING',
          message: 'No hay destinatarios (chat_id) configurados ni especificados para la prueba.',
        },
      });
      return;
    }

    const provider = telegramProviderFactory
      ? telegramProviderFactory(config.botToken)
      : new FetchTelegramProvider(config.botToken);

    try {
      await provider.verify();
      await provider.send(
        '🔔 *Prueba de conexión*\nSistema de Preinscripciones FLACSO Uruguay\nLas alertas de recuperación por Telegram están operativas.',
        targetChatId
      );

      const now = new Date();
      await encryptedSettingsService.setEncryptedSetting(SETTING_TELEGRAM_LAST_TESTED_AT, now.toISOString(), req.adminUser?.email);
      await encryptedSettingsService.setEncryptedSetting(SETTING_TELEGRAM_LAST_TEST_STATUS, 'ok', req.adminUser?.email);
      await encryptedSettingsService.setEncryptedSetting(SETTING_TELEGRAM_LAST_TEST_ERROR, '', req.adminUser?.email);

      res.json({
        ok: true,
        message: `Mensaje de prueba enviado con éxito al chat ${maskChatId(targetChatId)}.`,
      });
    } catch (err) {
      const rawError = err instanceof Error ? err.message : String(err);
      const safeError = sanitizeTelegramError(rawError);

      const now = new Date();
      await encryptedSettingsService.setEncryptedSetting(SETTING_TELEGRAM_LAST_TESTED_AT, now.toISOString(), req.adminUser?.email);
      await encryptedSettingsService.setEncryptedSetting(SETTING_TELEGRAM_LAST_TEST_STATUS, 'error', req.adminUser?.email);
      await encryptedSettingsService.setEncryptedSetting(SETTING_TELEGRAM_LAST_TEST_ERROR, safeError, req.adminUser?.email);

      res.status(400).json({
        error: {
          code: 'TELEGRAM_TEST_FAILED',
          message: `Fallo al verificar o enviar mensaje a Telegram: ${safeError}`,
        },
      });
    }
  });

  // --- Recovery routes ---
  router.get('/recoveries', async (req, res) => {
    if (!submissionRecoveryRepository) {
      res.status(503).json({
        error: { code: 'RECOVERY_UNAVAILABLE', message: 'Servicio de recuperación no disponible.' },
      });
      return;
    }

    const parsed = ListRecoveriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'INVALID_QUERY', message: 'Parámetros de búsqueda inválidos.', details: parsed.error.flatten() },
      });
      return;
    }

    const { status, stage, targetId, search, limit, offset } = parsed.data;
    const statusFilter = status
      ? status.includes(',')
        ? (status.split(',').map((s) => s.trim()) as RecoveryStatus[])
        : (status as RecoveryStatus)
      : undefined;

    const list = await submissionRecoveryRepository.listFailed({
      status: statusFilter,
      stage: stage as RecoveryStage | undefined,
      targetId,
      search,
      limit,
      offset,
    });

    res.json({
      recoveries: list.map((r) => ({
        id: r.id,
        submissionId: r.submissionId,
        targetId: r.targetId,
        targetTitle: r.targetTitle,
        targetKind: r.targetKind,
        stage: r.stage,
        status: r.status,
        safeError: r.safeError,
        attemptCount: r.attemptCount,
        firstFailedAt: r.firstFailedAt.toISOString(),
        lastAttemptAt: r.lastAttemptAt.toISOString(),
        retentionExpiresAt: r.retentionExpiresAt.toISOString(),
        lockedUntil: r.lockedUntil?.toISOString() ?? null,
        lockedBy: r.lockedBy ?? null,
        discardedAt: r.discardedAt?.toISOString() ?? null,
        discardedBy: r.discardedBy ?? null,
        discardReason: r.discardReason ?? null,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  });

  router.get('/recoveries/:id', async (req, res) => {
    if (!submissionRecoveryRepository) {
      res.status(503).json({
        error: { code: 'RECOVERY_UNAVAILABLE', message: 'Servicio de recuperación no disponible.' },
      });
      return;
    }

    const recovery = await submissionRecoveryRepository.findById(req.params.id);
    if (!recovery) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Caso de recuperación no encontrado.' },
      });
      return;
    }

    res.json({
      recovery: {
        id: recovery.id,
        submissionId: recovery.submissionId,
        targetId: recovery.targetId,
        targetTitle: recovery.targetTitle,
        targetKind: recovery.targetKind,
        stage: recovery.stage,
        status: recovery.status,
        safeError: recovery.safeError,
        attemptCount: recovery.attemptCount,
        firstFailedAt: recovery.firstFailedAt.toISOString(),
        lastAttemptAt: recovery.lastAttemptAt.toISOString(),
        retentionExpiresAt: recovery.retentionExpiresAt.toISOString(),
        lockedUntil: recovery.lockedUntil?.toISOString() ?? null,
        lockedBy: recovery.lockedBy ?? null,
        discardedAt: recovery.discardedAt?.toISOString() ?? null,
        discardedBy: recovery.discardedBy ?? null,
        discardReason: recovery.discardReason ?? null,
        resolvedAt: recovery.resolvedAt?.toISOString() ?? null,
        createdAt: recovery.createdAt.toISOString(),
        updatedAt: recovery.updatedAt.toISOString(),
        files: (recovery.files ?? []).map((file) => ({
          token: file.token,
          fieldKey: file.fieldKey,
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.size,
          driveFileId: file.driveFileId ?? null,
          uploadedAt: null,
          status: file.status === 'success' && file.driveFileId
            ? 'stored_in_drive'
            : file.status === 'pending'
              ? 'pending_in_storage'
              : 'missing',
        })),
        values: recovery.values,
      },
    });
  });

  router.post('/recoveries/:id/retry', async (req, res) => {
    if (!submissionRecoveryRepository || !submissionRepository || !catalog) {
      res.status(503).json({
        error: { code: 'RECOVERY_UNAVAILABLE', message: 'Servicio de recuperación no disponible.' },
      });
      return;
    }

    const adminEmail = (req as RequestWithAdminSession).adminUser?.email ?? 'web@flacso.edu.uy';
    const result = await retryFailedSubmission(
      {
        recoveryIdOrSubmissionId: req.params.id,
        adminEmail,
      },
      {
        recoveryRepository: submissionRecoveryRepository,
        submissionRepository,
        catalog,
        fileDependencies: temporaryFileStorage && googleDriveRepository
          ? { storage: temporaryFileStorage, drive: googleDriveRepository }
          : undefined,
        spreadsheetDependencies: targetSpreadsheetService && spreadsheetRepository
          ? { targetSpreadsheetService, repository: spreadsheetRepository }
          : undefined,
        notificationDependencies: emailNotificationRepository
          ? {
              repository: emailNotificationRepository,
              getMasterEmails: async () => {
                if (encryptedSettingsService) {
                  try {
                    const cfg = await loadEmailConfig(encryptedSettingsService);
                    return cfg.masterEmails;
                  } catch {
                    return [];
                  }
                }
                return [];
              },
            }
          : undefined,
        telegramDependencies: telegramAlertRepository && encryptedSettingsService
          ? {
              repository: telegramAlertRepository,
              getPreinscriptionChatIds: async () => {
                try {
                  const cfg = await loadTelegramConfig(encryptedSettingsService);
                  return cfg.preinscriptionEnabled && cfg.chatIds ? cfg.chatIds : [];
                } catch {
                  return [];
                }
              },
            }
          : undefined,
      }
    );

    if (result.ok) {
      res.json({
        ok: true,
        submissionId: result.submissionId,
        message: result.message,
      });
      return;
    }

    let statusCode = 500;
    if (result.code === 'NOT_FOUND' || result.code === 'TARGET_NOT_FOUND') {
      statusCode = 404;
    } else if (result.code === 'ALREADY_RESOLVED' || result.code === 'ALREADY_DISCARDED') {
      statusCode = 400;
    } else if (result.code === 'CONCURRENT_CLAIM' || result.code === 'CLAIM_FAILED') {
      statusCode = 409;
    } else if (result.code === 'MISSING_FILE') {
      statusCode = 422;
    }

    res.status(statusCode).json({
      error: {
        code: result.code,
        message: result.message,
      },
    });
  });

  router.delete('/recoveries/:id', async (req, res) => {
    if (!submissionRecoveryRepository) {
      res.status(503).json({
        error: { code: 'RECOVERY_UNAVAILABLE', message: 'Servicio de recuperación no disponible.' },
      });
      return;
    }

    const recovery = await submissionRecoveryRepository.findById(req.params.id);
    if (!recovery) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Caso de recuperación no encontrado.' },
      });
      return;
    }

    if (recovery.status === 'resolved') {
      res.status(400).json({
        error: { code: 'CANNOT_DISCARD_RESOLVED', message: 'No se puede descartar un caso ya resuelto.' },
      });
      return;
    }

    const parsed = DiscardRecoverySchema.safeParse(req.body);
    const reason = parsed.success ? parsed.data?.reason : undefined;
    const adminEmail = (req as RequestWithAdminSession).adminUser?.email ?? 'web@flacso.edu.uy';

    await submissionRecoveryRepository.discard(recovery.id, adminEmail, reason);

    if (submissionRepository?.markProcessing) {
      await submissionRepository.markProcessing(
        recovery.submissionId,
        'failed',
        reason ? `Descartado: ${reason}` : 'Descartado administrativamente.'
      );
    }

    if (temporaryFileStorage && recovery.files) {
      for (const file of recovery.files) {
        try {
          await temporaryFileStorage.remove(file.token);
        } catch {}
      }
    }

    res.json({
      ok: true,
      message: 'Caso descartado correctamente.',
    });
  });

  return router;
}
