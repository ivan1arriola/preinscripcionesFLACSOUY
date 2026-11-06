import { writeSheetsRow, type SheetsAttemptDependencies } from './write-sheets-row.js';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SubmissionRepository } from '../ports/submission-repository.js';
import type { SubmissionRecoveryRepository } from '../ports/submission-recovery-repository.js';
import type { TemporaryFileStoragePort } from '../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../ports/spreadsheet-repository.js';
import type { TargetSpreadsheetService } from './target-spreadsheet-service.js';
import type { EmailNotificationRepository } from '../ports/email-notification-repository.js';
import type { TelegramAlertRepository } from '../ports/telegram-alert-repository.js';
import { getCanonicalFormDefinition } from '../domain/canonical-forms.js';
import { normalizeIdentityValues } from '../domain/identity-validation.js';
import { driveTargetDescriptor } from '../domain/google-drive-naming.js';
import { sanitizeSafeError } from '../domain/safe-error.js';
import { createPreinscriptionNotifications } from './create-preinscription-notifications.js';
import { applicantNameFromValues, enqueuePreinscriptionTelegramNotifications } from './preinscription-telegram-notification.js';
import { buildSpreadsheetSchema, buildSpreadsheetValues } from '../domain/spreadsheet-schema.js';

export interface RetrySubmissionDependencies {
  recoveryRepository: SubmissionRecoveryRepository;
  submissionRepository: SubmissionRepository;
  catalog: AcademicCatalog;
  fileDependencies?: {
    storage: TemporaryFileStoragePort;
    drive: GoogleDriveRepositoryPort;
  };
  spreadsheetDependencies?: {
    targetSpreadsheetService: TargetSpreadsheetService;
    repository: SpreadsheetRepository;
    attempts?: SheetsAttemptDependencies;
  };
  notificationDependencies?: {
    repository: EmailNotificationRepository;
    getMasterEmails?: () => Promise<string[]> | string[];
  };
  telegramDependencies?: {
    repository: TelegramAlertRepository;
    getPreinscriptionChatIds?: () => Promise<string[]> | string[];
  };
}

export interface RetryFailedSubmissionOptions {
  recoveryIdOrSubmissionId: string;
  adminEmail: string;
  now?: Date;
  leaseDurationMs?: number;
}

export type RetryFailedSubmissionResult =
  | {
      ok: true;
      submissionId: string;
      message: string;
    }
  | {
      ok: false;
      code:
        | 'NOT_FOUND'
        | 'ALREADY_RESOLVED'
        | 'ALREADY_DISCARDED'
        | 'CONCURRENT_CLAIM'
        | 'CLAIM_FAILED'
        | 'TARGET_NOT_FOUND'
        | 'MISSING_FILE'
        | 'DRIVE_ERROR'
        | 'SHEETS_ERROR'
        | 'CONFIGURATION_ERROR';
      message: string;
    };

export async function retryFailedSubmission(
  options: RetryFailedSubmissionOptions,
  dependencies: RetrySubmissionDependencies
): Promise<RetryFailedSubmissionResult> {
  const now = options.now ?? new Date();
  const leaseDurationMs = options.leaseDurationMs ?? 60000;
  const lockedBy = options.adminEmail;

  const claimed = await dependencies.recoveryRepository.claim(
    options.recoveryIdOrSubmissionId,
    now,
    leaseDurationMs,
    lockedBy
  );

  if (!claimed) {
    const existing = await dependencies.recoveryRepository.findById(options.recoveryIdOrSubmissionId);
    if (!existing) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `No se encontró el caso de recuperación "${options.recoveryIdOrSubmissionId}".`,
      };
    }
    if (existing.status === 'resolved') {
      return {
        ok: false,
        code: 'ALREADY_RESOLVED',
        message: 'El caso ya fue recuperado exitosamente.',
      };
    }
    if (existing.status === 'discarded') {
      return {
        ok: false,
        code: 'ALREADY_DISCARDED',
        message: 'El caso fue descartado y no puede ser reintentado.',
      };
    }
    if (existing.lockedUntil && existing.lockedUntil > now) {
      return {
        ok: false,
        code: 'CONCURRENT_CLAIM',
        message: 'El caso se encuentra actualmente en procesamiento por otro operador.',
      };
    }
    return {
      ok: false,
      code: 'CLAIM_FAILED',
      message: 'No se pudo adquirir el bloqueo del caso para su reintento.',
    };
  }

  const recovery = await dependencies.recoveryRepository.findById(claimed.id);
  if (!recovery) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'No se pudieron cargar los detalles del caso de recuperación.',
    };
  }

  const submissionId = recovery.submissionId;
  const allFiles = recovery.files ?? [];
  const storedValues = recovery.values ?? {};

  // 1. Revalidate target in academic catalog. Upstream outages must leave the
  // recovery case retryable instead of escaping the HTTP worker.
  let target: Awaited<ReturnType<AcademicCatalog['revalidateTarget']>>;
  try {
    target = await dependencies.catalog.revalidateTarget(recovery.targetId);
  } catch (err) {
    const safeError = sanitizeSafeError(
      err,
      'No se pudo validar la oferta académica con WordPress. Intentá nuevamente cuando el catálogo esté disponible.'
    );
    await dependencies.recoveryRepository.markRetryResult(recovery.id, {
      success: false,
      stage: recovery.stage === 'notifications' ? 'notifications' : 'sheets',
      safeError,
      now,
    });
    if (recovery.stage !== 'notifications') await dependencies.submissionRepository.markProcessing(submissionId, 'failed', safeError);
    return {
      ok: false,
      code: 'CONFIGURATION_ERROR',
      message: safeError,
    };
  }
  if (!target) {
    const safeError = `No se encontró el destino académico "${recovery.targetId}" para procesar la preinscripción.`;
    await dependencies.recoveryRepository.markRetryResult(recovery.id, {
      success: false,
      stage: recovery.stage === 'notifications' ? 'notifications' : 'sheets',
      safeError,
      now,
    });
    return {
      ok: false,
      code: 'TARGET_NOT_FOUND',
      message: safeError,
    };
  }

  // 2. Prepare canonical form and descriptor
  const agreements = dependencies.catalog.listAgreements
    ? await dependencies.catalog.listAgreements()
    : [];
  const composition = getCanonicalFormDefinition(target, agreements);
  if (!composition.ok) {
    const safeError = sanitizeSafeError(
      new Error(composition.error.message),
      'El formulario de la oferta no es compatible con el formulario canónico.'
    );
    await dependencies.recoveryRepository.markRetryResult(recovery.id, {
      success: false,
      stage: recovery.stage === 'notifications' ? 'notifications' : 'sheets',
      safeError,
      now,
    });
    if (recovery.stage !== 'notifications') await dependencies.submissionRepository.markProcessing(submissionId, 'failed', safeError);
    return {
      ok: false,
      code: 'CONFIGURATION_ERROR',
      message: safeError,
    };
  }
  const form = composition.value;
  const normalizedValues = normalizeIdentityValues(storedValues);
  if (recovery.stage === 'notifications') {
    try {
      if (!dependencies.notificationDependencies) throw new Error('La cola de notificaciones no está configurada.');
      const masters = dependencies.notificationDependencies.getMasterEmails
        ? await dependencies.notificationDependencies.getMasterEmails() : [];
      const spreadsheet = !recovery.spreadsheetUrl && dependencies.spreadsheetDependencies
        ? await dependencies.spreadsheetDependencies.targetSpreadsheetService.ensureForTarget(target) : null;
      await createPreinscriptionNotifications(dependencies.notificationDependencies.repository, {
        submissionId, target, form, values: normalizedValues,
        spreadsheetRowUrl: recovery.spreadsheetUrl || spreadsheet?.url || (spreadsheet?.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}/edit` : ''),
        documentsFolderUrl: recovery.documentsFolderUrl || '', masterRecipients: masters,
      });
      if (!target.notificationEmails?.length) {
        const safeError = 'El destino no tiene correos de coordinación configurados en el catálogo.';
        await dependencies.recoveryRepository.markRetryResult(recovery.id, { success: false, stage: 'notifications', safeError, now });
        return { ok: false, code: 'CONFIGURATION_ERROR', message: safeError };
      }
      await dependencies.submissionRepository.markProcessing(submissionId, 'success');
      await dependencies.recoveryRepository.markRetryResult(recovery.id, { success: true, now });
      return { ok: true, submissionId, message: 'Notificaciones encoladas para su envío.' };
    } catch {
      const safeError = 'No se pudo encolar las notificaciones; el caso sigue pendiente.';
      await dependencies.recoveryRepository.markRetryResult(recovery.id, { success: false, stage: 'notifications', safeError, now });
      return { ok: false, code: 'CONFIGURATION_ERROR', message: safeError };
    }
  }
  const driveTarget = driveTargetDescriptor(target);

  let documentsFolderUrl = '';
  let newlyStoredFileItems: Array<{ token: string; driveFileId?: string }> = [];

  // 3. Drive Stage: check which files need uploading
  const pendingFiles = allFiles.filter((f) => f.status !== 'success' || !f.driveFileId);

  if (pendingFiles.length > 0) {
    if (!dependencies.fileDependencies) {
      const safeError = 'El almacenamiento de archivos no se encuentra disponible.';
      await dependencies.recoveryRepository.markRetryResult(recovery.id, {
        success: false,
        stage: 'drive',
        safeError,
        now,
      });
      return {
        ok: false,
        code: 'CONFIGURATION_ERROR',
        message: safeError,
      };
    }

    const driveFiles: Array<{
      token: string;
      fieldKey: string;
      originalName: string;
      mimeType: string;
      data: Buffer;
    }> = [];

    for (const file of pendingFiles) {
      try {
        const temporary = await dependencies.fileDependencies.storage.open(file.token);
        driveFiles.push({
          token: file.token,
          fieldKey: file.fieldKey,
          originalName: temporary.originalName,
          mimeType: temporary.mimeType,
          data: temporary.data,
        });
      } catch {
        const missingMsg = `No se pudo recuperar: el archivo temporal para "${file.originalName}" (${file.fieldKey}) expiró o no se encuentra disponible.`;
        await dependencies.recoveryRepository.markRetryResult(recovery.id, {
          success: false,
          stage: 'drive',
          safeError: missingMsg,
          now,
        });
        await dependencies.submissionRepository.markProcessing(submissionId, 'failed', missingMsg);
        return {
          ok: false,
          code: 'MISSING_FILE',
          message: missingMsg,
        };
      }
    }

    if (driveFiles.length > 0) {
      try {
        const stored = await dependencies.fileDependencies.drive.storeSubmissionFiles({
          submissionId,
          files: driveFiles,
          target: driveTarget,
          values: normalizedValues,
        });
        const fileItems = Array.isArray(stored) ? stored : (stored.files ?? stored);
        newlyStoredFileItems = fileItems;
        documentsFolderUrl = (!Array.isArray(stored) && stored.documentsFolderUrl) ? stored.documentsFolderUrl : '';
        for (const file of fileItems) {
          if (file.driveFileId) {
            await dependencies.submissionRepository.markFileStored(file.token, file.driveFileId);
          }
        }
      } catch (err) {
        const safeError = sanitizeSafeError(err, 'No se pudo guardar la documentación en Google Drive.');
        for (const file of driveFiles) {
          await dependencies.submissionRepository.markFileFailed(file.token, safeError);
        }
        await dependencies.recoveryRepository.markRetryResult(recovery.id, {
          success: false,
          stage: 'drive',
          safeError,
          now,
        });
        await dependencies.submissionRepository.markProcessing(submissionId, 'failed', safeError);
        return {
          ok: false,
          code: 'DRIVE_ERROR',
          message: safeError,
        };
      }
    }
  }

  // 4. Sheets Stage
  let spreadsheetRowUrl = '';
  if (dependencies.spreadsheetDependencies) {
    try {
      const fileIdByToken = new Map<string, string>();
      for (const f of allFiles) {
        if (f.driveFileId) fileIdByToken.set(f.token, f.driveFileId);
      }
      for (const item of newlyStoredFileItems) {
        if (item.driveFileId) fileIdByToken.set(item.token, item.driveFileId);
      }
      const driveFilesRef = allFiles.map((f) => ({
        fieldKey: f.fieldKey,
        token: f.token,
        driveFileId: fileIdByToken.get(f.token),
      }));

      const spreadsheetSchema = buildSpreadsheetSchema(form);
      const valuesByColumnName = buildSpreadsheetValues(
        form,
        normalizedValues,
        recovery.submissionId,
        now,
        {
          documentsFolderUrl: documentsFolderUrl || undefined,
          files: driveFilesRef,
        }
      );
      const requiredColumns = spreadsheetSchema.requiredColumns;

      const spreadsheet = await dependencies.spreadsheetDependencies.targetSpreadsheetService.ensureForTarget(target);
      await writeSheetsRow(dependencies.spreadsheetDependencies, {
        submissionId,
        spreadsheetId: spreadsheet.spreadsheetId,
        sheetName: spreadsheet.sheetName,
        requiredColumns,
        valuesByColumnName,
        now,
      });
      spreadsheetRowUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}/edit`;
    } catch (err) {
      const safeError = sanitizeSafeError(err, 'No se pudo crear o guardar la planilla de la preinscripción.');
      await dependencies.recoveryRepository.markRetryResult(recovery.id, {
        success: false,
        stage: 'sheets',
        safeError,
        now,
      });
      await dependencies.submissionRepository.markProcessing(submissionId, 'failed', safeError);
      return {
        ok: false,
        code: 'SHEETS_ERROR',
        message: safeError,
      };
    }
  }

  // La fila ya está guardada: registrar primero la etapa de correo permite recuperarla
  // sin volver a escribir Sheets si el proceso se interrumpe.
  if (dependencies.notificationDependencies) {
    await dependencies.recoveryRepository.markRetryResult(recovery.id, { success: false, stage: 'notifications', safeError: 'Notificaciones pendientes de encolado.', spreadsheetUrl: spreadsheetRowUrl, documentsFolderUrl, now });
  }
  await dependencies.submissionRepository.markProcessing(submissionId, 'success');

  // 6. Enqueue notifications if configured
  if (dependencies.notificationDependencies) {
    try {
      const masterRecipients = dependencies.notificationDependencies.getMasterEmails
        ? await dependencies.notificationDependencies.getMasterEmails()
        : [];
      await createPreinscriptionNotifications(dependencies.notificationDependencies.repository, {
        submissionId,
        target,
        form,
        values: normalizedValues,
        spreadsheetRowUrl,
        documentsFolderUrl,
        masterRecipients,
      });
      if (!target.notificationEmails?.length) {
        const safeError = 'El destino no tiene correos de coordinación configurados en el catálogo.';
        await dependencies.recoveryRepository.markRetryResult(recovery.id, { success: false, stage: 'notifications', safeError, spreadsheetUrl: spreadsheetRowUrl, documentsFolderUrl, now });
        return { ok: false, code: 'CONFIGURATION_ERROR', message: safeError };
      }
    } catch {
      const safeError = 'No se pudieron encolar las notificaciones; el caso sigue pendiente.';
      await dependencies.recoveryRepository.markRetryResult(recovery.id, { success: false, stage: 'notifications', safeError, spreadsheetUrl: spreadsheetRowUrl, documentsFolderUrl, now });
      return { ok: false, code: 'CONFIGURATION_ERROR', message: safeError };
    }
  }
  await dependencies.recoveryRepository.markRetryResult(recovery.id, { success: true, now });

  // 6b. Enqueue Telegram preinscription notifications if configured
  if (dependencies.telegramDependencies?.repository && dependencies.telegramDependencies.getPreinscriptionChatIds) {
    try {
      const chatIds = await dependencies.telegramDependencies.getPreinscriptionChatIds();
      if (chatIds && chatIds.length > 0) {
        await enqueuePreinscriptionTelegramNotifications({
          repository: dependencies.telegramDependencies.repository,
          submissionId,
          target,
          chatIds,
          applicantName: applicantNameFromValues(normalizedValues),
          occurredAt: now,
        });
      }
    } catch (tgErr) {
      console.error(
        '[Recovery] Error al encolar notificación Telegram tras reintento:',
        sanitizeSafeError(tgErr, 'Error al encolar notificación de Telegram.')
      );
    }
  }

  // 7. Cleanup temporary files on success
  if (dependencies.fileDependencies?.storage && allFiles.length > 0) {
    for (const file of allFiles) {
      try {
        await dependencies.fileDependencies.storage.remove(file.token);
      } catch (cleanErr) {
        console.error('[Recovery] Error al limpiar archivo temporal:', cleanErr);
      }
    }
  }

  return {
    ok: true,
    submissionId,
    message: 'La preinscripción fue procesada y recuperada con éxito.',
  };
}
