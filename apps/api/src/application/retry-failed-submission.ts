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
import { enqueuePreinscriptionTelegramNotifications } from './preinscription-telegram-notification.js';

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

  // 1. Revalidate target in academic catalog
  const target = await dependencies.catalog.revalidateTarget(recovery.targetId);
  if (!target) {
    const safeError = `No se encontró el destino académico "${recovery.targetId}" para procesar la preinscripción.`;
    await dependencies.recoveryRepository.markRetryResult(recovery.id, {
      success: false,
      stage: 'sheets',
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
  const form = composition.ok ? composition.value : (target as any);
  const normalizedValues = normalizeIdentityValues(storedValues);
  const driveTarget = driveTargetDescriptor(target);

  let documentsFolderUrl = '';

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
        if (dependencies.submissionRepository.recordProcessingFailure) {
          await dependencies.submissionRepository.recordProcessingFailure(submissionId, 'drive', missingMsg, 7);
        } else {
          await dependencies.submissionRepository.markProcessing(submissionId, 'failed', missingMsg);
        }
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
        if (dependencies.submissionRepository.recordProcessingFailure) {
          await dependencies.submissionRepository.recordProcessingFailure(submissionId, 'drive', safeError, 7);
        } else {
          await dependencies.submissionRepository.markProcessing(submissionId, 'failed', safeError);
        }
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
      const valuesByColumnName = Object.fromEntries(
        (form.inputs ?? []).map((input: any) => [
          input.spreadsheetColumn ?? input.label,
          normalizedValues[input.key] ?? '',
        ])
      );
      const requiredColumns = (form.inputs ?? [])
        .filter((input: any) => input.required)
        .map((input: any) => input.spreadsheetColumn ?? input.label);

      const spreadsheet = await dependencies.spreadsheetDependencies.targetSpreadsheetService.ensureForTarget(target);
      const appendRes = await dependencies.spreadsheetDependencies.repository.appendByHeaders(
        spreadsheet.spreadsheetId,
        valuesByColumnName,
        requiredColumns,
        spreadsheet.sheetName
      );
      if (appendRes?.rowUrl) {
        spreadsheetRowUrl = appendRes.rowUrl;
      }
    } catch (err) {
      const safeError = sanitizeSafeError(err, 'No se pudo crear o guardar la planilla de la preinscripción.');
      await dependencies.recoveryRepository.markRetryResult(recovery.id, {
        success: false,
        stage: 'sheets',
        safeError,
        now,
      });
      if (dependencies.submissionRepository.recordProcessingFailure) {
        await dependencies.submissionRepository.recordProcessingFailure(submissionId, 'sheets', safeError, 7);
      } else {
        await dependencies.submissionRepository.markProcessing(submissionId, 'failed', safeError);
      }
      return {
        ok: false,
        code: 'SHEETS_ERROR',
        message: safeError,
      };
    }
  }

  // 5. Complete Success
  await dependencies.recoveryRepository.markRetryResult(recovery.id, {
    success: true,
    now,
  });
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
    } catch (notifErr) {
      console.error('[Recovery] Error al encolar notificaciones tras reintento:', notifErr);
    }
  }

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
          occurredAt: now,
        });
      }
    } catch (tgErr) {
      console.error(
        '[Recovery] Error al encolar notificación Telegram tras reintento:',
        sanitizeSafeError(tgErr)
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
