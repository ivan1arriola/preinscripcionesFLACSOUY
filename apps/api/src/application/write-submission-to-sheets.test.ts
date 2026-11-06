import { describe, expect, it, vi } from 'vitest';
import {
  writeSubmissionToSheets,
  type WriteSubmissionToSheetsDeps,
  type WriteSubmissionToSheetsInput,
} from './write-submission-to-sheets.js';
import type { SheetsAttemptStore, SheetsAttemptRecord } from '../ports/sheets-attempt-store.js';
import type { SubmissionProcessingRepository } from '../ports/submission-processing-repository.js';
import type { SpreadsheetRepository } from '../ports/spreadsheet-repository.js';

class MemorySheetsAttemptStore implements SheetsAttemptStore {
  public records = new Map<string, SheetsAttemptRecord>();

  async get(submissionId: string): Promise<SheetsAttemptRecord | null> {
    return this.records.get(submissionId) ?? null;
  }

  async recordAttemptStarted(submissionId: string, startedAt: Date): Promise<void> {
    const existing = this.records.get(submissionId) ?? {
      submissionId,
      status: 'pending',
      sheetAttemptStartedAt: null,
      sheetWrittenAt: null,
      nextAttemptAt: null,
    };
    this.records.set(submissionId, {
      ...existing,
      sheetAttemptStartedAt: startedAt,
    });
  }

  async markUncertain(submissionId: string, nextAttemptAt: Date, _error?: string): Promise<void> {
    const existing = this.records.get(submissionId) ?? {
      submissionId,
      status: 'pending',
      sheetAttemptStartedAt: null,
      sheetWrittenAt: null,
      nextAttemptAt: null,
    };
    this.records.set(submissionId, {
      ...existing,
      status: 'sheet_uncertain',
      nextAttemptAt,
    });
  }

  async recordWritten(submissionId: string, writtenAt: Date): Promise<void> {
    const existing = this.records.get(submissionId) ?? {
      submissionId,
      status: 'pending',
      sheetAttemptStartedAt: null,
      sheetWrittenAt: null,
      nextAttemptAt: null,
    };
    this.records.set(submissionId, {
      ...existing,
      status: 'success',
      sheetWrittenAt: writtenAt,
    });
  }
}

describe('writeSubmissionToSheets', () => {
  function setup() {
    const store = new MemorySheetsAttemptStore();
    const spreadsheetRepository: SpreadsheetRepository = {
      readHeaders: vi.fn(),
      appendByHeaders: vi.fn().mockResolvedValue({
        spreadsheetId: 'sheet-1',
        sheetName: 'Respuestas',
        sheetId: 0,
        updatedRange: 'Respuestas!A2:E2',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0&range=A2:E2',
        updatedRows: 1,
      }),
      diagnose: vi.fn(),
      countTrackingId: vi.fn().mockResolvedValue(0),
    };
    const tasks: Pick<SubmissionProcessingRepository, 'enqueueTask'> = {
      enqueueTask: vi.fn().mockResolvedValue(undefined),
    };
    const deps: WriteSubmissionToSheetsDeps = {
      store,
      spreadsheetRepository,
      tasks,
    };
    const baseInput: WriteSubmissionToSheetsInput = {
      submissionId: 'sub-123',
      spreadsheetId: 'sheet-1',
      sheetName: 'Respuestas',
      valuesByColumnName: { Nombre: 'Ana', 'ID de seguimiento': 'sub-123' },
      requiredColumns: ['Nombre', 'ID de seguimiento'],
      trackingId: 'sub-123',
      now: new Date('2026-11-06T12:00:00Z'),
    };
    return { store, spreadsheetRepository, tasks, deps, baseInput };
  }

  it('camino normal: guarda sheet_attempt_started_at, inserta la fila, guarda sheet_written_at, sin lecturas a la hoja y sin tareas encoladas', async () => {
    const { store, spreadsheetRepository, tasks, deps, baseInput } = setup();

    const result = await writeSubmissionToSheets(deps, baseInput);

    expect(result.status).toBe('success');
    expect(result).toMatchObject({ status: 'success', writtenAt: baseInput.now });

    // Verificación de estado durable
    const savedRecord = await store.get('sub-123');
    expect(savedRecord?.sheetAttemptStartedAt).toEqual(baseInput.now);
    expect(savedRecord?.sheetWrittenAt).toEqual(baseInput.now);
    expect(savedRecord?.status).toBe('success');

    // Costo cero: no lee la hoja y no programa tareas
    expect(spreadsheetRepository.countTrackingId).not.toHaveBeenCalled();
    expect(tasks.enqueueTask).not.toHaveBeenCalled();
    expect(spreadsheetRepository.appendByHeaders).toHaveBeenCalledOnce();
  });

  it('fallo antes de aplicarse (error de red/timeout): deja sheet_uncertain a +200 s y encola sheets_reconcile', async () => {
    const { store, spreadsheetRepository, tasks, deps, baseInput } = setup();
    vi.mocked(spreadsheetRepository.appendByHeaders).mockRejectedValueOnce(
      new Error('fetch failed: ETIMEDOUT')
    );

    const result = await writeSubmissionToSheets(deps, baseInput);

    expect(result.status).toBe('uncertain');
    const expectedNext = new Date('2026-11-06T12:03:20Z'); // 12:00:00 + 200 s
    if (result.status === 'uncertain') {
      expect(result.nextAttemptAt).toEqual(expectedNext);
      expect(result.error).toContain('ETIMEDOUT');
    }

    const savedRecord = await store.get('sub-123');
    expect(savedRecord?.status).toBe('sheet_uncertain');
    expect(savedRecord?.sheetAttemptStartedAt).toEqual(baseInput.now);
    expect(savedRecord?.nextAttemptAt).toEqual(expectedNext);
    expect(savedRecord?.sheetWrittenAt).toBeNull();

    expect(tasks.enqueueTask).toHaveBeenCalledWith({
      submissionId: 'sub-123',
      kind: 'sheets_reconcile',
      runAt: expectedNext,
    });
    expect(spreadsheetRepository.countTrackingId).not.toHaveBeenCalled();
  });

  it('reintento inmediato anterior a next_attempt_at: no espera, no escribe, no lee y responde { status: "wait", retryAt }', async () => {
    const { store, spreadsheetRepository, tasks, deps, baseInput } = setup();
    const startedAt = new Date('2026-11-06T12:00:00Z');
    const nextAttemptAt = new Date('2026-11-06T12:03:20Z'); // +200 s
    await store.recordAttemptStarted('sub-123', startedAt);
    await store.markUncertain('sub-123', nextAttemptAt, 'timeout previo');

    // Reintento apenas 30 segundos después (12:00:30 < 12:03:20)
    const retryNow = new Date('2026-11-06T12:00:30Z');
    const result = await writeSubmissionToSheets(deps, {
      ...baseInput,
      now: retryNow,
    });

    expect(result).toEqual({
      status: 'wait',
      retryAt: nextAttemptAt,
    });

    // Ninguna llamada externa
    expect(spreadsheetRepository.appendByHeaders).not.toHaveBeenCalled();
    expect(spreadsheetRepository.countTrackingId).not.toHaveBeenCalled();
    expect(tasks.enqueueTask).not.toHaveBeenCalled();
  });

  it('reintento a tiempo (now >= next_attempt_at) cuando el batch NO se aplicó: reconcilia (count 0), inserta, encola recuentos a +15 min y +2 h y guarda sheet_written_at', async () => {
    const { store, spreadsheetRepository, tasks, deps, baseInput } = setup();
    const startedAt = new Date('2026-11-06T12:00:00Z');
    const nextAttemptAt = new Date('2026-11-06T12:03:20Z');
    await store.recordAttemptStarted('sub-123', startedAt);
    await store.markUncertain('sub-123', nextAttemptAt, 'timeout previo');

    // Reintento al cumplirse los 200 s
    const retryNow = new Date('2026-11-06T12:03:25Z');
    vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(0);

    const result = await writeSubmissionToSheets(deps, {
      ...baseInput,
      now: retryNow,
    });

    expect(result.status).toBe('success');
    expect(spreadsheetRepository.countTrackingId).toHaveBeenCalledWith('sheet-1', 'Respuestas', 'sub-123');
    expect(spreadsheetRepository.appendByHeaders).toHaveBeenCalledOnce();

    // Encola recuentos diferidos
    expect(tasks.enqueueTask).toHaveBeenCalledWith({
      submissionId: 'sub-123',
      kind: 'sheets_recount',
      runAt: new Date(retryNow.getTime() + 15 * 60_000), // +15 min
    });
    expect(tasks.enqueueTask).toHaveBeenCalledWith({
      submissionId: 'sub-123',
      kind: 'sheets_recount',
      runAt: new Date(retryNow.getTime() + 2 * 60 * 60_000), // +2 h
    });

    const savedRecord = await store.get('sub-123');
    expect(savedRecord?.sheetWrittenAt).toEqual(retryNow);
  });

  it('respuesta perdida con batch aplicado: reconcilia al cumplirse el plazo (count 1), NO vuelve a insertar, guarda sheet_written_at y confirma éxito', async () => {
    const { store, spreadsheetRepository, tasks, deps, baseInput } = setup();
    const startedAt = new Date('2026-11-06T12:00:00Z');
    const nextAttemptAt = new Date('2026-11-06T12:03:20Z');
    await store.recordAttemptStarted('sub-123', startedAt);
    await store.markUncertain('sub-123', nextAttemptAt, 'conexión cerrada por timeout');

    const retryNow = new Date('2026-11-06T12:03:30Z');
    // El batch sí se había aplicado en Google Sheets
    vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(1);

    const result = await writeSubmissionToSheets(deps, {
      ...baseInput,
      now: retryNow,
    });

    expect(result).toMatchObject({
      status: 'success',
      alreadyPresent: true,
      writtenAt: retryNow,
    });

    expect(spreadsheetRepository.countTrackingId).toHaveBeenCalledWith('sheet-1', 'Respuestas', 'sub-123');
    // NO inserta nuevamente
    expect(spreadsheetRepository.appendByHeaders).not.toHaveBeenCalled();
    // No encola recuentos porque no hubo una segunda inserción
    expect(tasks.enqueueTask).not.toHaveBeenCalled();

    const savedRecord = await store.get('sub-123');
    expect(savedRecord?.sheetWrittenAt).toEqual(retryNow);
  });

  it('si ya fue confirmado como escrito previamente, retorna éxito inmediato sin llamadas', async () => {
    const { store, spreadsheetRepository, tasks, deps, baseInput } = setup();
    const writtenAt = new Date('2026-11-06T11:50:00Z');
    await store.recordWritten('sub-123', writtenAt);

    const result = await writeSubmissionToSheets(deps, baseInput);

    expect(result).toMatchObject({
      status: 'success',
      alreadyPresent: true,
      writtenAt,
    });
    expect(spreadsheetRepository.appendByHeaders).not.toHaveBeenCalled();
    expect(spreadsheetRepository.countTrackingId).not.toHaveBeenCalled();
    expect(tasks.enqueueTask).not.toHaveBeenCalled();
  });
});
