import type { SheetsAttemptStore } from '../ports/sheets-attempt-store.js';
import type { SpreadsheetRepository, AppendResult } from '../ports/spreadsheet-repository.js';
import type { SubmissionProcessingRepository } from '../ports/submission-processing-repository.js';

export const UNCERTAIN_DELAY_MS = 200 * 1000; // 200 s (por encima de los 180 s documentados por Google)
export const RECOUNT_15_MIN_MS = 15 * 60 * 1000; // +15 min
export const RECOUNT_2_H_MS = 2 * 60 * 60 * 1000; // +2 h

export interface WriteSubmissionToSheetsInput {
  submissionId: string;
  spreadsheetId: string;
  sheetName?: string;
  valuesByColumnName: Record<string, string>;
  requiredColumns: string[];
  trackingId?: string;
  now?: Date;
}

export type WriteSubmissionToSheetsResult =
  | { status: 'success'; writtenAt: Date; rowUrl?: string; alreadyPresent?: boolean }
  | { status: 'wait'; retryAt: Date }
  | { status: 'uncertain'; nextAttemptAt: Date; error: string };

export interface WriteSubmissionToSheetsDeps {
  store: SheetsAttemptStore;
  spreadsheetRepository: Pick<SpreadsheetRepository, 'appendByHeaders' | 'countTrackingId'>;
  tasks: Pick<SubmissionProcessingRepository, 'enqueueTask'>;
}

/**
 * Servicio de escritura de preinscripciones en Google Sheets con estado durable e incertidumbre (P3).
 *
 * 1. Guarda sheet_attempt_started_at antes de enviar.
 * 2. Si el intento termina sin confirmación (timeout/error de red), deja 'sheet_uncertain' con
 *    next_attempt_at = started_at + 200 s y encola sheets_reconcile con ese run_at.
 * 3. Un reintento anterior a next_attempt_at NO espera ni escribe: responde { status: 'wait', retryAt }.
 * 4. Al llegar next_attempt_at, reconcilia con countTrackingId y solo inserta si el ID no está.
 * 5. Tras cualquier inserción en estado incierto, encola recuentos sheets_recount a +15 min y +2 h.
 * 6. Al confirmarse la escritura, guarda sheet_written_at.
 * 7. El camino normal (sin incertidumbre previa) no lee la hoja y no programa nada (costo cero).
 */
export async function writeSubmissionToSheets(
  deps: WriteSubmissionToSheetsDeps,
  input: WriteSubmissionToSheetsInput
): Promise<WriteSubmissionToSheetsResult> {
  const now = input.now ?? new Date();
  const trackingId = input.trackingId ?? input.submissionId;
  const sheetName = input.sheetName ?? 'Sheet1';

  // 1. Verificar si ya fue confirmado como escrito
  const attempt = await deps.store.get(input.submissionId);
  if (attempt?.sheetWrittenAt) {
    return {
      status: 'success',
      writtenAt: attempt.sheetWrittenAt,
      alreadyPresent: true,
    };
  }

  // 2. Comprobar si existe un intento incierto previo pendiente
  const isUncertain =
    attempt?.status === 'sheet_uncertain' ||
    (attempt?.sheetAttemptStartedAt !== null && attempt?.sheetAttemptStartedAt !== undefined && !attempt?.sheetWrittenAt);

  if (isUncertain) {
    const nextAttemptAt =
      attempt?.nextAttemptAt ??
      new Date(attempt!.sheetAttemptStartedAt!.getTime() + UNCERTAIN_DELAY_MS);

    // Si aún no se cumplió el plazo de 200 s: NO esperar ni escribir, responder cuándo volver
    if (now.getTime() < nextAttemptAt.getTime()) {
      return {
        status: 'wait',
        retryAt: nextAttemptAt,
      };
    }

    // Al llegar next_attempt_at: reconciliar primero
    if (!deps.spreadsheetRepository.countTrackingId) {
      throw new Error('El repositorio de planillas no implementa countTrackingId');
    }

    const count = await deps.spreadsheetRepository.countTrackingId(
      input.spreadsheetId,
      sheetName,
      trackingId
    );

    if (count > 0) {
      // El batch anterior se aplicó en Google Sheets: confirmar sin volver a insertar
      await deps.store.recordWritten(input.submissionId, now);
      return {
        status: 'success',
        writtenAt: now,
        alreadyPresent: true,
      };
    }

    // El ID no está en la hoja: insertar
    let appendResult: AppendResult;
    try {
      appendResult = await deps.spreadsheetRepository.appendByHeaders(
        input.spreadsheetId,
        input.valuesByColumnName,
        input.requiredColumns,
        sheetName
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const newNext = new Date(now.getTime() + UNCERTAIN_DELAY_MS);
      await deps.store.markUncertain(input.submissionId, newNext, errorMsg);
      await deps.tasks.enqueueTask({
        submissionId: input.submissionId,
        kind: 'sheets_reconcile',
        runAt: newNext,
      });
      return {
        status: 'uncertain',
        nextAttemptAt: newNext,
        error: errorMsg,
      };
    }

    // Inserción en estado incierto completada: encolar recuentos diferidos (+15 min y +2 h)
    await deps.tasks.enqueueTask({
      submissionId: input.submissionId,
      kind: 'sheets_recount',
      runAt: new Date(now.getTime() + RECOUNT_15_MIN_MS),
    });
    await deps.tasks.enqueueTask({
      submissionId: input.submissionId,
      kind: 'sheets_recount',
      runAt: new Date(now.getTime() + RECOUNT_2_H_MS),
    });

    await deps.store.recordWritten(input.submissionId, now);
    return {
      status: 'success',
      writtenAt: now,
      rowUrl: appendResult.rowUrl,
    };
  }

  // 3. Camino normal (sin incertidumbre previa)
  const startedAt = now;
  await deps.store.recordAttemptStarted(input.submissionId, startedAt);

  let appendResult: AppendResult;
  try {
    appendResult = await deps.spreadsheetRepository.appendByHeaders(
      input.spreadsheetId,
      input.valuesByColumnName,
      input.requiredColumns,
      sheetName
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const nextAttemptAt = new Date(startedAt.getTime() + UNCERTAIN_DELAY_MS);
    await deps.store.markUncertain(input.submissionId, nextAttemptAt, errorMsg);
    await deps.tasks.enqueueTask({
      submissionId: input.submissionId,
      kind: 'sheets_reconcile',
      runAt: nextAttemptAt,
    });
    return {
      status: 'uncertain',
      nextAttemptAt,
      error: errorMsg,
    };
  }

  await deps.store.recordWritten(input.submissionId, now);
  return {
    status: 'success',
    writtenAt: now,
    rowUrl: appendResult.rowUrl,
  };
}
