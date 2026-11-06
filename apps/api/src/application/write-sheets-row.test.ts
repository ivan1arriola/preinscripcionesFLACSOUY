import { describe, expect, it, vi } from 'vitest';
import { SheetsPendingError, writeSheetsRow } from './write-sheets-row.js';

const input = {
  submissionId: 'sub-1', spreadsheetId: 'sheet-1', sheetName: 'Hoja', requiredColumns: ['ID de seguimiento'],
  valuesByColumnName: { 'ID de seguimiento': 'sub-1' },
};

describe('writeSheetsRow', () => {
  it('without durable attempts it appends directly (legacy behaviour)', async () => {
    const repository = { appendByHeaders: vi.fn().mockResolvedValue({}) };
    await writeSheetsRow({ repository: repository as never }, input);
    expect(repository.appendByHeaders).toHaveBeenCalledWith('sheet-1', input.valuesByColumnName, input.requiredColumns, 'Hoja');
  });

  it('with durable attempts a lost response becomes a pending error instead of a silent retry', async () => {
    const repository = { appendByHeaders: vi.fn().mockRejectedValue(new Error('ETIMEDOUT')), countTrackingId: vi.fn() };
    const records = new Map<string, any>();
    const store = {
      get: async (id: string) => records.get(id) ?? null,
      recordAttemptStarted: async (id: string, at: Date) => { records.set(id, { submissionId: id, status: 'pending', sheetAttemptStartedAt: at, sheetWrittenAt: null, nextAttemptAt: null }); },
      markUncertain: async (id: string, next: Date) => { records.set(id, { ...records.get(id), status: 'sheet_uncertain', nextAttemptAt: next }); },
      recordWritten: async () => undefined,
    };
    const tasks = { enqueueTask: vi.fn().mockResolvedValue(undefined) };
    const now = new Date('2026-11-06T12:00:00Z');

    await expect(writeSheetsRow({ repository: repository as never, attempts: { store, tasks } }, { ...input, now }))
      .rejects.toBeInstanceOf(SheetsPendingError);
    expect(tasks.enqueueTask).toHaveBeenCalledWith({ submissionId: 'sub-1', kind: 'sheets_reconcile', runAt: new Date('2026-11-06T12:03:20Z') });

    // Reintento inmediato: no escribe ni lee la hoja, responde cuándo volver.
    repository.appendByHeaders.mockClear();
    const err = await writeSheetsRow({ repository: repository as never, attempts: { store, tasks } }, { ...input, now: new Date('2026-11-06T12:01:00Z') }).catch((e) => e);
    expect(err).toBeInstanceOf(SheetsPendingError);
    expect(err.retryAt).toEqual(new Date('2026-11-06T12:03:20Z'));
    expect(repository.appendByHeaders).not.toHaveBeenCalled();
  });

  it('with durable attempts a confirmed write returns normally and an already written row is not appended again', async () => {
    const repository = { appendByHeaders: vi.fn().mockResolvedValue({ rowUrl: 'u' }), countTrackingId: vi.fn() };
    const store = {
      get: async () => ({ submissionId: 'sub-1', status: 'failed', sheetAttemptStartedAt: new Date(), sheetWrittenAt: new Date(), nextAttemptAt: null }),
      recordAttemptStarted: vi.fn(), markUncertain: vi.fn(), recordWritten: vi.fn(),
    };
    await writeSheetsRow({ repository: repository as never, attempts: { store, tasks: { enqueueTask: vi.fn() } } }, input);
    expect(repository.appendByHeaders).not.toHaveBeenCalled();
  });
});
