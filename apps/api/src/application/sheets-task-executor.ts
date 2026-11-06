import type {
  SubmissionTask,
  SubmissionProcessingRepository,
} from '../ports/submission-processing-repository.js';
import type { TaskExecutors } from './sweep-abandoned-submissions.js';
import type { SheetsAttemptStore } from '../ports/sheets-attempt-store.js';
import type { SpreadsheetRepository } from '../ports/spreadsheet-repository.js';
import type { CreateRecoveryInput } from '../ports/submission-recovery-repository.js';
import type { TelegramAlertRepository } from '../ports/telegram-alert-repository.js';
import {
  writeSubmissionToSheets,
  type WriteSubmissionToSheetsDeps,
  type WriteSubmissionToSheetsInput,
  type WriteSubmissionToSheetsResult,
} from './write-submission-to-sheets.js';

export interface SubmissionSheetsContext {
  targetId: string;
  spreadsheetId: string;
  sheetName?: string;
  valuesByColumnName: Record<string, string>;
  requiredColumns: string[];
  trackingId?: string;
}

export interface SheetsTaskExecutorDeps {
  store: SheetsAttemptStore;
  spreadsheetRepository: Pick<SpreadsheetRepository, 'appendByHeaders' | 'countTrackingId'>;
  tasks: Pick<SubmissionProcessingRepository, 'enqueueTask'>;
  recoveryRepository: {
    recordFailure(input: CreateRecoveryInput): Promise<{ id: string }>;
  };
  loadSubmissionContext: (submissionId: string) => Promise<SubmissionSheetsContext | null>;
  writeSubmissionToSheets?: (
    deps: WriteSubmissionToSheetsDeps,
    input: WriteSubmissionToSheetsInput
  ) => Promise<WriteSubmissionToSheetsResult>;
  telegramAlertRepository?: TelegramAlertRepository;
  getTelegramChatIds?: () => Promise<string[]> | string[];
  telegramAlerts?: {
    enqueueAlert(input: {
      submissionId: string;
      targetId: string;
      message: string;
      recoveryId?: string;
    }): Promise<void>;
  };
  now?: () => Date;
}

/**
 * Ejecuta una tarea diferida de Sheets de la cola durable (sheets_reconcile o sheets_recount).
 * Funciona aunque el envío ya esté en status: 'success' y aunque exista un caso activo.
 */
export async function executeSheetsTask(
  deps: SheetsTaskExecutorDeps,
  task: SubmissionTask
): Promise<void> {
  const context = await deps.loadSubmissionContext(task.submissionId);
  if (!context) {
    throw new Error(
      `No se pudo cargar el contexto de la preinscripción ${task.submissionId} para la tarea ${task.kind}`
    );
  }

  const now = deps.now ? deps.now() : new Date();
  const trackingId = context.trackingId ?? task.submissionId;
  const sheetName = context.sheetName ?? 'Sheet1';

  if (task.kind === 'sheets_reconcile') {
    const writeFn = deps.writeSubmissionToSheets ?? writeSubmissionToSheets;
    const result = await writeFn(deps, {
      submissionId: task.submissionId,
      spreadsheetId: context.spreadsheetId,
      sheetName,
      valuesByColumnName: context.valuesByColumnName,
      requiredColumns: context.requiredColumns,
      trackingId,
      now,
    });

    if (result.status === 'uncertain') {
      throw new Error(result.error);
    }
    // 'wait': todavía no corresponde reconciliar. Quien reprogramó la espera encoló otra tarea para ese momento,
    // así que esta termina sin gastar un intento.
    return;
  }

  if (task.kind === 'sheets_recount') {
    if (!deps.spreadsheetRepository.countTrackingId) {
      throw new Error('El repositorio de planillas no implementa countTrackingId');
    }

    const count = await deps.spreadsheetRepository.countTrackingId(
      context.spreadsheetId,
      sheetName,
      trackingId
    );

    if (count > 1) {
      const safeError = `El ID de seguimiento "${trackingId}" aparece ${count} veces en la planilla (${context.spreadsheetId}, hoja "${sheetName}"). Eliminar la fila sobrante en la planilla y marcar el caso como resuelto.`;

      const recovery = await deps.recoveryRepository.recordFailure({
        submissionId: task.submissionId,
        targetId: context.targetId,
        stage: 'sheets_duplicate',
        safeError,
        retentionDays: 7,
        now,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
          context.spreadsheetId
        )}/edit`,
      });

      const alertMessage = [
        '⚠️ Incidente de preinscripción FLACSO (duplicado en Sheets)',
        `• ID de seguimiento: ${trackingId}`,
        `• Destino: ${context.targetId}`,
        `• Etapa: SHEETS_DUPLICATE`,
        `• Detalle técnico: El ID aparece ${count} veces en la planilla.`,
        '• Procedimiento: eliminar la fila sobrante en la planilla y marcar el caso como resuelto.',
      ].join('\n');

      if (deps.telegramAlerts?.enqueueAlert) {
        await deps.telegramAlerts.enqueueAlert({
          submissionId: task.submissionId,
          targetId: context.targetId,
          recoveryId: recovery?.id,
          message: alertMessage,
        });
      }

      if (deps.telegramAlertRepository && deps.getTelegramChatIds) {
        const chatIds = await deps.getTelegramChatIds();
        if (chatIds && chatIds.length > 0) {
          await deps.telegramAlertRepository.enqueue(
            chatIds.map((chatId) => ({
              recoveryId: recovery?.id ?? null,
              submissionId: task.submissionId,
              chatId,
              message: alertMessage,
            }))
          );
        }
      }
    }
  }
}

/**
 * Crea ejecutores de tareas de Sheets compatibles con el tipo TaskExecutors de sweepOnce.
 */
export function createSheetsTaskExecutors(deps: SheetsTaskExecutorDeps): TaskExecutors {
  return {
    sheets_reconcile: async (task: SubmissionTask) => {
      await executeSheetsTask(deps, task);
    },
    sheets_recount: async (task: SubmissionTask) => {
      await executeSheetsTask(deps, task);
    },
  };
}
