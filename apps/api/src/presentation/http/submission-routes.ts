import { writeSheetsRow, type SheetsAttemptDependencies } from '../../application/write-sheets-row.js';
import type { SubmissionProcessingRepository } from '../../ports/submission-processing-repository.js';
import { Router } from 'express';
import { z } from 'zod';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import { submitPreinscription } from '../../application/submit-preinscription.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import type { TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';
import type { EmailNotificationRepository } from '../../ports/email-notification-repository.js';
import { createPreinscriptionNotifications } from '../../application/create-preinscription-notifications.js';
import type { SubmissionRecoveryRepository } from '../../ports/submission-recovery-repository.js';
import type { TelegramAlertRepository } from '../../ports/telegram-alert-repository.js';
import {
  applicantNameFromValues,
  enqueuePreinscriptionTelegramNotifications,
} from '../../application/preinscription-telegram-notification.js';
import { buildSpreadsheetValues } from '../../domain/spreadsheet-schema.js';
import { RateLimiter, rateLimitedResponse, type RateLimitOptions } from './rate-limit.js';

export function sanitizeSafeError(error: unknown, fallback: string = 'Error de procesamiento técnico.'): string {
  if (!error) return fallback;
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (!rawMessage || typeof rawMessage !== 'string') return fallback;

  let sanitized = rawMessage
    .replace(/([?&](key|token|secret|password|access_token)=)[^&]+/gi, '$1***')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer ***')
    .trim();

  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 497) + '...';
  }
  return sanitized || fallback;
}

async function tryEnqueueTelegramAlert(
  recoveryDeps: SubmissionRecoveryDependencies | undefined,
  recoveryId: string | undefined,
  submissionId: string,
  targetId: string,
  stage: string,
  safeError: string
): Promise<void> {
  if (!recoveryDeps?.telegramAlertRepository || !recoveryDeps.getTelegramChatIds) {
    return;
  }
  try {
    const chatIds = await recoveryDeps.getTelegramChatIds();
    if (!chatIds || chatIds.length === 0) {
      return;
    }
    const message = [
      '⚠️ Incidente de preinscripción FLACSO',
      `• ID de seguimiento: ${submissionId}`,
      `• Destino: ${targetId}`,
      `• Etapa: ${stage.toUpperCase()}`,
      `• Detalle técnico: ${safeError}`,
      '• Retención: 7 días para recuperación administrativa',
    ].join('\n');

    await recoveryDeps.telegramAlertRepository.enqueue(
      chatIds.map((chatId) => ({
        recoveryId: recoveryId ?? null,
        submissionId,
        chatId,
        message,
      }))
    );
  } catch (err) {
    console.error('[Telegram Alerts] Error al encolar alertas de incidente:', err);
  }
}

const MAX_SUBMISSION_FILES = 20;

const submissionSchema = z.object({
  // La columna es varchar(128): un identificador más largo provocaría un 500 al guardar.
  clientSubmissionId: z.string().min(1).max(128).optional(),
  configRevision: z.string({ required_error: 'La revisión de configuración es obligatoria.' }),
  values: z.record(z.string().max(5000), {
    required_error: 'Los valores del formulario son obligatorios.',
  }),
  files: z.array(z.object({
    token: z.string(), fieldKey: z.string(), originalName: z.string(), size: z.number(), mimeType: z.string(),
  })).max(MAX_SUBMISSION_FILES).default([]).refine(
    (files) => new Set(files.map((file) => file.token)).size === files.length,
    { message: 'Un mismo archivo no puede adjuntarse más de una vez.' },
  ),
});

interface SubmissionFileDependencies {
  storage: TemporaryFileStoragePort;
  drive: GoogleDriveRepositoryPort;
}

interface SubmissionSpreadsheetDependencies {
  repository: SpreadsheetRepository;
  targetSpreadsheetService: TargetSpreadsheetService;
  /** Intentos durables de Sheets (P3); sin ellos se escribe directo. */
  attempts?: SheetsAttemptDependencies;
}

export interface SubmissionNotificationDependencies {
  repository: EmailNotificationRepository;
  getMasterEmails?: () => Promise<string[]> | string[];
}

export interface SubmissionRecoveryDependencies {
  repository: SubmissionRecoveryRepository;
  telegramAlertRepository?: TelegramAlertRepository;
  getTelegramChatIds?: () => Promise<string[]> | string[];
  getTelegramPreinscriptionChatIds?: () => Promise<string[]> | string[];
}

export interface SubmissionTelegramDependencies {
  repository: TelegramAlertRepository;
  getPreinscriptionChatIds?: () => Promise<string[]> | string[];
  getRecoveryChatIds?: () => Promise<string[]> | string[];
}

export interface LeaseOptions {
  repository: Pick<SubmissionProcessingRepository, 'renewLease' | 'releaseLease'>;
  /** Cada cuánto se renueva el lease mientras el envío trabaja. Por defecto 20 s. */
  renewEveryMs?: number;
  /** Duración de cada renovación. Por defecto 60 s. */
  ttlMs?: number;
}

/**
 * Mantiene vivo el lease de un envío mientras se procesa. `stop()` detiene el temporizador y libera el lease;
 * es idempotente y nunca lanza (un fallo al renovar solo se registra: el barrido decidirá).
 */
function startLeaseRenewal(options: LeaseOptions, submissionId: string, owner: string): { stop: () => Promise<void> } {
  const ttlMs = options.ttlMs ?? 60_000;
  const timer = setInterval(() => {
    options.repository.renewLease(submissionId, owner, new Date(), ttlMs).catch((error) => {
      console.error('[Lease] No se pudo renovar el lease del envío:', error instanceof Error ? error.message : error);
    });
  }, options.renewEveryMs ?? 20_000);
  timer.unref?.();
  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try {
        await options.repository.releaseLease(submissionId, owner);
      } catch (error) {
        console.error('[Lease] No se pudo liberar el lease del envío:', error instanceof Error ? error.message : error);
      }
    },
  };
}

export function createSubmissionRoutes(
  catalog: AcademicCatalog,
  repository: SubmissionRepository,
  fileDependencies?: SubmissionFileDependencies,
  spreadsheetDependencies?: SubmissionSpreadsheetDependencies,
  notificationDependencies?: SubmissionNotificationDependencies,
  recoveryDependencies?: SubmissionRecoveryDependencies,
  telegramDependencies?: SubmissionTelegramDependencies,
  mauticDependencies?: { isContactSyncEnabled: () => Promise<boolean>; isEnrollmentNotifyEnabled?: () => Promise<boolean> },
  limits?: { perEmail?: RateLimitOptions },
  lease?: LeaseOptions,
): Router {
  const router = Router({ mergeParams: true });
  const emailLimiter = limits?.perEmail ? new RateLimiter(limits.perEmail) : undefined;

  router.post('/', async (req, res, next) => {
    let leaseGuard: { stop: () => Promise<void> } | undefined;
    try {
      const params = req.params as Record<string, string | undefined>;
      const targetId = params.id ?? '';

      const parsed = submissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'El cuerpo de la solicitud no cumple con el formato esperado.',
            details: parsed.error.flatten(),
          },
        });
        return;
      }

      // Reintento del mismo envío (doble clic, corte de red): se devuelve el resultado original sin repetir
      // Drive, planilla, correos ni alertas, y sin marcar como fallido un envío que ya terminó bien.
      if (parsed.data.clientSubmissionId && repository.findByClientSubmissionId) {
        const previous = await repository.findByClientSubmissionId(parsed.data.clientSubmissionId);
        if (previous) {
          res.status(200).json({ submissionId: previous.id, existing: true });
          return;
        }
      }

      // Cada token debe existir en la sesión del postulante y haberse subido para el campo que declara;
      // de lo contrario un mismo archivo podría presentarse como CV, título e identidad a la vez.
      const sessionHeader = req.header('x-preinscription-session')?.trim();
      if (parsed.data.files.length > 0 && sessionHeader && fileDependencies?.storage.listBySession) {
        const uploaded = new Map(
          (await fileDependencies.storage.listBySession(sessionHeader)).map((record) => [record.token, record]),
        );
        // Un token ausente no es un archivo «de otro campo»: la limpieza lo borró porque venció (30 min sin
        // actividad). Se avisa con FILE_EXPIRED y con todos los campos afectados para que se recarguen de una vez.
        const expired = parsed.data.files.filter((file) => !uploaded.has(file.token));
        if (expired.length > 0) {
          const fields = [...new Set(expired.map((file) => file.fieldKey))];
          res.status(400).json({
            error: {
              code: 'FILE_EXPIRED',
              message: 'Uno o más archivos adjuntos vencieron y ya no están disponibles. Volvé a cargarlos.',
              field: fields[0],
              fields,
            },
          });
          return;
        }
        const mismatched = parsed.data.files.find((file) => uploaded.get(file.token)?.fieldKey !== file.fieldKey);
        if (mismatched) {
          res.status(400).json({
            error: {
              code: 'INVALID_FILE',
              message: 'Uno de los archivos adjuntos no corresponde al campo indicado. Volvé a cargarlo.',
              field: mismatched.fieldKey,
            },
          });
          return;
        }
      }

      const emailKey = parsed.data.values.email?.trim().toLowerCase();
      if (emailLimiter && emailKey) {
        const decision = emailLimiter.peek(emailKey);
        if (!decision.allowed) {
          res.setHeader('Retry-After', String(decision.retryAfterSeconds));
          res.status(429).json(rateLimitedResponse(decision.retryAfterSeconds));
          return;
        }
      }

      // Fijar los archivos (reanudable e idempotente) después de validar y antes de guardar: así ni la limpieza ni un
      // DELETE tardío pueden quitárselos a una preinscripción aceptada. Un envío ya aceptado nunca llega aquí.
      const pinStorage = fileDependencies?.storage;
      const shouldPin = parsed.data.files.length > 0 && !!sessionHeader && !!pinStorage?.pinFiles;
      let result: Awaited<ReturnType<typeof submitPreinscription>>;
      try {
        result = await submitPreinscription(catalog, repository, {
          clientSubmissionId: parsed.data.clientSubmissionId,
          targetId,
          configRevision: parsed.data.configRevision,
          values: parsed.data.values,
          files: parsed.data.files,
        }, {
          isMauticContactSyncEnabled: mauticDependencies?.isContactSyncEnabled,
          isMauticEnrollmentNotifyEnabled: mauticDependencies?.isEnrollmentNotifyEnabled,
          beforeSave: shouldPin
            ? () => pinStorage!.pinFiles!(parsed.data.files.map((f) => f.token), sessionHeader!, parsed.data.clientSubmissionId ?? '')
            : undefined,
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'FILE_EXPIRED') {
          res.status(400).json({ error: { code: 'FILE_EXPIRED', message: 'Uno de los archivos adjuntos venció. Volvé a cargarlo.' } });
          return;
        }
        if (code === 'FORBIDDEN') {
          res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Uno de los archivos adjuntos no pertenece a tu sesión.' } });
          return;
        }
        throw error;
      }

      if (!result.ok) {
        switch (result.code) {
          case 'NOT_FOUND':
            res.status(404).json({
              error: {
                code: 'NOT_FOUND',
                message: result.message,
              },
            });
            return;
          case 'CLOSED':
            res.status(409).json({
              error: {
                code: 'CLOSED',
                message: result.message,
              },
            });
            return;
          case 'STALE_REVISION':
            res.status(409).json({
              error: {
                code: 'STALE_REVISION',
                message: result.message,
                fieldErrors: result.fieldErrors,
              },
            });
            return;
          case 'INCOMPATIBLE_FORM':
            res.status(409).json({
              error: {
                code: 'INCOMPATIBLE_FORM',
                message: result.message,
                issues: result.issues,
              },
            });
            return;
          case 'CATALOG_UNAVAILABLE':
            res.status(503).json({
              error: {
                code: 'CATALOG_UNAVAILABLE',
                message: result.message,
              },
            });
            return;
          case 'VALIDATION_ERROR':
            res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: result.message,
                fieldErrors: result.fieldErrors,
              },
            });
            return;
        }
      }

      // Carrera entre dos peticiones con el mismo identificador: la otra ya ejecuta los efectos.
      if (result.existing) {
        res.status(200).json({ submissionId: result.submissionId, existing: true });
        return;
      }

      if (emailLimiter && emailKey) emailLimiter.hit(emailKey);

      // Desde aquí el envío es nuestro: se mantiene vivo su lease hasta terminar, sea cual sea la salida.
      if (lease && result.leaseOwner) {
        leaseGuard = startLeaseRenewal(lease, result.submissionId, result.leaseOwner);
      }

      const files = parsed.data.files;
      let storedDriveFiles: Array<{ token: string; driveFileId?: string }> = [];
      let documentsFolderUrl = '';
      if (files.length > 0) {
        if (!fileDependencies) {
          await repository.markProcessing(result.submissionId, 'failed', 'La carga de documentación no está disponible en este momento.');
          res.status(503).json({ error: { code: 'FILE_PROCESSING_UNAVAILABLE', message: 'La carga de documentación no está disponible en este momento.' } });
          return;
        }
        const sessionId = req.header('x-preinscription-session')?.trim();
        if (!sessionId) {
          await repository.markProcessing(result.submissionId, 'failed', 'La sesión de preinscripción es obligatoria para enviar archivos.');
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'La sesión de preinscripción es obligatoria para enviar archivos.' } });
          return;
        }
        try {
          const driveFiles = [];
          for (const file of files) {
            const temporary = await fileDependencies.storage.open(file.token, sessionId);
            driveFiles.push({ token: file.token, fieldKey: file.fieldKey, originalName: temporary.originalName, mimeType: temporary.mimeType, data: temporary.data });
          }
          const stored = await fileDependencies.drive.storeSubmissionFiles({
            submissionId: result.submissionId,
            files: driveFiles,
            target: result.driveTarget,
            values: parsed.data.values,
          });
          const fileItems = Array.isArray(stored) ? stored : (stored.files ?? stored);
          storedDriveFiles = fileItems;
          documentsFolderUrl = (!Array.isArray(stored) && stored.documentsFolderUrl) ? stored.documentsFolderUrl : '';
          for (const file of fileItems) {
            if (file.driveFileId) {
              await repository.markFileStored(file.token, file.driveFileId);
            }
          }
        } catch (error) {
          const safeError = sanitizeSafeError(error, 'No se pudo guardar la documentación.');
          for (const file of files) {
            await repository.markFileFailed(file.token, safeError);
          }
          let recoveryRecord;
          if (recoveryDependencies?.repository) {
            await repository.markProcessing(result.submissionId, 'failed', safeError);
            recoveryRecord = await recoveryDependencies.repository.recordFailure({
              submissionId: result.submissionId,
              targetId,
              stage: 'drive',
              safeError,
              retentionDays: 7,
            });
          } else if (repository.recordProcessingFailure) {
            await repository.recordProcessingFailure(result.submissionId, 'drive', safeError, 7);
          } else {
            await repository.markProcessing(result.submissionId, 'failed', safeError);
          }
          if (fileDependencies?.storage.extendRetention && files.length > 0) {
            const retentionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await fileDependencies.storage.extendRetention(files.map((f) => f.token), retentionExpiresAt);
          }
          await tryEnqueueTelegramAlert(
            recoveryDependencies,
            recoveryRecord?.id,
            result.submissionId,
            targetId,
            'drive',
            safeError
          );
          res.status(202).json({
            submissionId: result.submissionId,
            status: 'pending_processing',
            message: 'La preinscripción fue recibida y se encuentra pendiente de procesamiento técnico.',
          });
          return;
        }
      }

      let spreadsheetRowUrl = '';
      if (spreadsheetDependencies) {
        try {
          const target = result.target;
          const spreadsheet = await spreadsheetDependencies.targetSpreadsheetService.ensureForTarget(target);

          const fileIdByToken = new Map<string, string>();
          for (const item of storedDriveFiles) {
            if (item.driveFileId) fileIdByToken.set(item.token, item.driveFileId);
          }
          const driveFilesRef = files.map((f) => ({
            fieldKey: f.fieldKey,
            token: f.token,
            driveFileId: fileIdByToken.get(f.token),
          }));

          const valuesByColumnName = buildSpreadsheetValues(
            result.form,
            result.normalizedValues,
            result.submissionId,
            new Date(),
            {
              documentsFolderUrl: documentsFolderUrl || undefined,
              files: driveFilesRef,
            }
          );

          await writeSheetsRow(spreadsheetDependencies, {
            submissionId: result.submissionId,
            spreadsheetId: spreadsheet.spreadsheetId,
            sheetName: spreadsheet.sheetName,
            requiredColumns: result.spreadsheet.requiredColumns,
            valuesByColumnName,
          });
          spreadsheetRowUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}/edit`;
        } catch (error) {
          const safeError = sanitizeSafeError(error, 'No se pudo crear o guardar la planilla de la preinscripción.');
          let recoveryRecord;
          if (recoveryDependencies?.repository) {
            await repository.markProcessing(result.submissionId, 'failed', safeError);
            recoveryRecord = await recoveryDependencies.repository.recordFailure({
              submissionId: result.submissionId,
              targetId,
              stage: 'sheets',
              safeError,
              retentionDays: 7,
            });
          } else if (repository.recordProcessingFailure) {
            await repository.recordProcessingFailure(result.submissionId, 'sheets', safeError, 7);
          } else {
            await repository.markProcessing(result.submissionId, 'failed', safeError);
          }
          if (fileDependencies?.storage.extendRetention && files.length > 0) {
            const retentionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await fileDependencies.storage.extendRetention(files.map((f) => f.token), retentionExpiresAt);
          }
          await tryEnqueueTelegramAlert(
            recoveryDependencies,
            recoveryRecord?.id,
            result.submissionId,
            targetId,
            'sheets',
            safeError
          );
          res.status(202).json({
            submissionId: result.submissionId,
            status: 'pending_processing',
            message: 'La preinscripción fue recibida y se encuentra pendiente de procesamiento técnico.',
          });
          return;
        }
      }

      let reservedRecoveryId: string | undefined;
      if (notificationDependencies && recoveryDependencies?.repository && repository.markSuccessWithNotificationIntent) {
        reservedRecoveryId = await repository.markSuccessWithNotificationIntent(result.submissionId, { targetId, spreadsheetUrl: spreadsheetRowUrl, documentsFolderUrl });
      } else {
        await repository.markProcessing(result.submissionId, 'success');
      }

      if (notificationDependencies) {
        let missingCoordinationEmail = false;
        // Fallback para repositorios sin soporte de transacción conjunta.
        if (!reservedRecoveryId && recoveryDependencies?.repository) {
          try {
            const reserved = await recoveryDependencies.repository.recordFailure({ submissionId: result.submissionId, targetId, stage: 'notifications', safeError: 'Encolado de notificaciones en curso.', retentionDays: 7, spreadsheetUrl: spreadsheetRowUrl, documentsFolderUrl });
            reservedRecoveryId = reserved.id;
          } catch {
            console.error('[Notifications] No se pudo reservar el caso de recuperación previo al encolado.');
          }
        }
        try {
          const masterRecipients = notificationDependencies.getMasterEmails
            ? await notificationDependencies.getMasterEmails()
            : [];
          await createPreinscriptionNotifications(notificationDependencies.repository, {
            submissionId: result.submissionId,
            target: result.target,
            form: result.form,
            values: result.normalizedValues,
            storedDocumentKeys: files.filter((file) => storedDriveFiles.some((stored) => stored.token === file.token && !!stored.driveFileId)).map((file) => file.fieldKey),
            spreadsheetRowUrl,
            documentsFolderUrl,
            masterRecipients,
          });
          if (!result.target.notificationEmails?.length) {
            missingCoordinationEmail = true;
            throw new Error('missing_coordination_email');
          }
          if (reservedRecoveryId) await recoveryDependencies!.repository.markRetryResult(reservedRecoveryId, { success: true });
        } catch {
          const safeError = missingCoordinationEmail
            ? 'El destino no tiene correos de coordinación configurados en el catálogo.'
            : 'No se pudieron encolar las notificaciones de la preinscripción.';
          console.error('[Notifications]', safeError);
          try {
            const recovery = recoveryDependencies?.repository
              ? await recoveryDependencies.repository.recordFailure({ submissionId: result.submissionId, targetId, stage: 'notifications', safeError, retentionDays: 7, spreadsheetUrl: spreadsheetRowUrl, documentsFolderUrl })
              : undefined;
            if (!recovery && repository.recordProcessingFailure) {
              await repository.recordProcessingFailure(result.submissionId, 'notifications', safeError, 7);
            }
            await tryEnqueueTelegramAlert(recoveryDependencies, recovery?.id, result.submissionId, targetId, 'notifications', safeError);
          } catch {
            console.error('[Notifications] No se pudo registrar el caso para recuperación.');
          }
        }
      }

      const telegramRepo = telegramDependencies?.repository ?? recoveryDependencies?.telegramAlertRepository;
      const getPreinscriptionChatIds =
        telegramDependencies?.getPreinscriptionChatIds ?? recoveryDependencies?.getTelegramPreinscriptionChatIds;

      if (telegramRepo && getPreinscriptionChatIds) {
        try {
          const chatIds = await getPreinscriptionChatIds();
          if (chatIds && chatIds.length > 0) {
            await enqueuePreinscriptionTelegramNotifications({
              repository: telegramRepo,
              submissionId: result.submissionId,
              target: result.target,
              chatIds,
              applicantName: applicantNameFromValues(result.normalizedValues),
              catalogValidation: result.catalogValidation,
            });
          }
        } catch (telegramError) {
          console.error(
            '[Telegram] Error al encolar notificación de preinscripción:',
            sanitizeSafeError(telegramError)
          );
        }
      }

      if (files.length > 0) {
        const sessionId = req.header('x-preinscription-session')?.trim();
        if (sessionId && fileDependencies) {
          for (const file of storedDriveFiles) {
            try {
              if (fileDependencies.storage.releaseRetained) await fileDependencies.storage.releaseRetained(file.token);
              else await fileDependencies.storage.remove(file.token, sessionId);
            } catch (cleanupError) {
              console.error('[Uploads] Error al limpiar archivo temporal:', cleanupError);
            }
          }
        }
      }

      res.status(201).json({ submissionId: result.submissionId });
    } catch (err) {
      next(err);
    } finally {
      await leaseGuard?.stop();
    }
  });

  return router;
}
