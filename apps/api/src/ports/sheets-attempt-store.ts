/** Instantánea de la fila a escribir: permite reconciliar un intento incierto sin reconstruirla. */
export interface SheetsPayload {
  spreadsheetId: string;
  sheetName?: string;
  requiredColumns: string[];
  trackingId?: string;
  valuesByColumnName: Record<string, string>;
}

export interface SheetsContext extends SheetsPayload {
  targetId: string;
}

export interface SheetsAttemptRecord {
  submissionId: string;
  status: string;
  sheetAttemptStartedAt: Date | null;
  sheetWrittenAt: Date | null;
  nextAttemptAt: Date | null;
  payload?: SheetsPayload | null;
}

export interface SheetsAttemptStore {
  /** Obtiene el estado actual del intento en submission_processing. */
  get(submissionId: string): Promise<SheetsAttemptRecord | null>;

  /** Registra el inicio de un intento antes de enviar la fila a Sheets. */
  recordAttemptStarted(submissionId: string, startedAt: Date, payload?: SheetsPayload): Promise<void>;

  /** Deja el estado 'sheet_uncertain' y fija next_attempt_at (started_at + 200 s). */
  markUncertain(submissionId: string, nextAttemptAt: Date, error?: string): Promise<void>;

  /**
   * Reclamo atómico por envío para reconciliar (contar + insertar): la tarea diferida y un reintento no deben
   * correr a la vez. Vence solo si el titular muere. Devuelve false si otro ya lo tiene.
   */
  claimReconcile?(submissionId: string, now: Date, ttlMs: number): Promise<boolean>;

  releaseReconcile?(submissionId: string): Promise<void>;

  /** Contexto para tareas diferidas (destino + instantánea); null si el envío no tiene intento registrado. */
  loadContext?(submissionId: string): Promise<SheetsContext | null>;

  /** Guarda sheet_written_at al confirmarse la escritura en Sheets y vacía los valores personales de la instantánea. */
  recordWritten(submissionId: string, writtenAt: Date): Promise<void>;
}
