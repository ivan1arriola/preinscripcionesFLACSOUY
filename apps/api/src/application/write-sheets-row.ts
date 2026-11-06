import type { SheetsAttemptStore } from '../ports/sheets-attempt-store.js';
import type { SpreadsheetRepository } from '../ports/spreadsheet-repository.js';
import type { SubmissionProcessingRepository } from '../ports/submission-processing-repository.js';
import { writeSubmissionToSheets } from './write-submission-to-sheets.js';

/** Intentos durables de Sheets (P3): sin ellos se escribe directo, como antes del protocolo. */
export interface SheetsAttemptDependencies {
  store: SheetsAttemptStore;
  tasks: Pick<SubmissionProcessingRepository, 'enqueueTask'>;
}

/**
 * La escritura en Sheets quedó sin confirmar. No es un fallo definitivo: una tarea la reconcilia contra la hoja
 * cuando vence la espera, y un reintento anterior a `retryAt` no escribe nada.
 */
export class SheetsPendingError extends Error {
  constructor(public readonly retryAt: Date) {
    super('La escritura en la planilla quedó pendiente de confirmación y se reconciliará automáticamente.');
    this.name = 'SheetsPendingError';
  }
}

export interface WriteSheetsRowInput {
  submissionId: string;
  spreadsheetId: string;
  sheetName?: string;
  requiredColumns: string[];
  valuesByColumnName: Record<string, string>;
  now?: Date;
}

/**
 * Punto único de escritura en Sheets para el envío y el reintento. Con `attempts` usa el estado durable (no repite
 * una fila ya escrita ni inserta a ciegas tras una respuesta perdida); sin él, conserva el comportamiento previo.
 * Lanza `SheetsPendingError` cuando el resultado es incierto o aún no corresponde reintentar.
 */
export async function writeSheetsRow(
  deps: { repository: SpreadsheetRepository; attempts?: SheetsAttemptDependencies },
  input: WriteSheetsRowInput,
): Promise<void> {
  if (!deps.attempts) {
    await deps.repository.appendByHeaders(input.spreadsheetId, input.valuesByColumnName, input.requiredColumns, input.sheetName);
    return;
  }
  const result = await writeSubmissionToSheets(
    { store: deps.attempts.store, spreadsheetRepository: deps.repository, tasks: deps.attempts.tasks },
    { ...input, trackingId: input.submissionId },
  );
  if (result.status === 'wait') throw new SheetsPendingError(result.retryAt);
  if (result.status === 'uncertain') throw new SheetsPendingError(result.nextAttemptAt);
}
