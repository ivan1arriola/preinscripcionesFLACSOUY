export interface SheetsAttemptRecord {
  submissionId: string;
  status: string;
  sheetAttemptStartedAt: Date | null;
  sheetWrittenAt: Date | null;
  nextAttemptAt: Date | null;
}

export interface SheetsAttemptStore {
  /** Obtiene el estado actual del intento en submission_processing. */
  get(submissionId: string): Promise<SheetsAttemptRecord | null>;

  /** Registra el inicio de un intento antes de enviar la fila a Sheets. */
  recordAttemptStarted(submissionId: string, startedAt: Date): Promise<void>;

  /** Deja el estado 'sheet_uncertain' y fija next_attempt_at (started_at + 200 s). */
  markUncertain(submissionId: string, nextAttemptAt: Date, error?: string): Promise<void>;

  /** Guarda sheet_written_at al confirmarse la escritura en Sheets. */
  recordWritten(submissionId: string, writtenAt: Date): Promise<void>;
}
