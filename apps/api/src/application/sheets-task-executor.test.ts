import { describe, expect, it, vi } from 'vitest';
import {
  executeSheetsTask,
  createSheetsTaskExecutors,
  type SheetsTaskExecutorDeps,
  type SubmissionSheetsContext,
} from './sheets-task-executor.js';
import type { SubmissionTask } from '../ports/submission-processing-repository.js';
import type { SheetsAttemptStore, SheetsAttemptRecord } from '../ports/sheets-attempt-store.js';
import type { SpreadsheetRepository } from '../ports/spreadsheet-repository.js';
import type { CreateRecoveryInput } from '../ports/submission-recovery-repository.js';
import type { TelegramAlertRepository } from '../ports/telegram-alert-repository.js';

class MemorySheetsAttemptStore implements SheetsAttemptStore {
  public records = new Map<string, SheetsAttemptRecord>();

  async get(submissionId: string): Promise<SheetsAttemptRecord | null> {
    return this.records.get(submissionId) ?? null;
  }

  async recordAttemptStarted(submissionId: string, startedAt: Date): Promise<void> {
    const r = this.records.get(submissionId) ?? {
      submissionId,
      status: 'pending',
      sheetAttemptStartedAt: null,
      sheetWrittenAt: null,
      nextAttemptAt: null,
    };
    this.records.set(submissionId, { ...r, sheetAttemptStartedAt: startedAt });
  }

  async markUncertain(submissionId: string, nextAttemptAt: Date, _error?: string): Promise<void> {
    const r = this.records.get(submissionId) ?? {
      submissionId,
      status: 'pending',
      sheetAttemptStartedAt: null,
      sheetWrittenAt: null,
      nextAttemptAt: null,
    };
    this.records.set(submissionId, { ...r, status: 'sheet_uncertain', nextAttemptAt });
  }

  async recordWritten(submissionId: string, writtenAt: Date): Promise<void> {
    const r = this.records.get(submissionId) ?? {
      submissionId,
      status: 'pending',
      sheetAttemptStartedAt: null,
      sheetWrittenAt: null,
      nextAttemptAt: null,
    };
    this.records.set(submissionId, { ...r, status: 'success', sheetWrittenAt: writtenAt });
  }
}

describe('sheets-task-executor', () => {
  function setup() {
    const store = new MemorySheetsAttemptStore();
    const enqueuedTasks: Array<{ submissionId: string; kind: string; runAt: Date }> = [];
    const recordedFailures: CreateRecoveryInput[] = [];
    const enqueuedAlerts: Array<{ submissionId: string; message: string; chatId: string }> = [];

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

    const tasks = {
      enqueueTask: vi.fn(async (task: { submissionId: string; kind: 'sheets_reconcile' | 'sheets_recount'; runAt: Date }) => {
        enqueuedTasks.push(task);
      }),
    };

    const recoveryRepository = {
      recordFailure: vi.fn(async (input: CreateRecoveryInput) => {
        recordedFailures.push(input);
        return { id: `rec-${recordedFailures.length}` };
      }),
    };

    const telegramAlertRepository: TelegramAlertRepository = {
      enqueue: vi.fn(async (alerts) => {
        for (const a of alerts) {
          enqueuedAlerts.push({ submissionId: a.submissionId, message: a.message, chatId: a.chatId });
        }
      }),
    } as unknown as TelegramAlertRepository;

    const sampleContext: SubmissionSheetsContext = {
      targetId: 'davia-c11',
      spreadsheetId: 'sheet-1',
      sheetName: 'Respuestas',
      valuesByColumnName: { Nombre: 'Lucía', 'ID de seguimiento': 'sub-dup-123' },
      requiredColumns: ['Nombre', 'ID de seguimiento'],
      trackingId: 'sub-dup-123',
    };

    const loadSubmissionContext = vi.fn().mockResolvedValue(sampleContext);

    let currentTime = new Date('2026-11-06T12:00:00Z');

    const deps: SheetsTaskExecutorDeps = {
      store,
      spreadsheetRepository,
      tasks,
      recoveryRepository,
      telegramAlertRepository,
      getTelegramChatIds: async () => ['chat-admin-1', 'chat-admin-2'],
      loadSubmissionContext,
      now: () => currentTime,
    };

    return {
      store,
      spreadsheetRepository,
      tasks,
      recoveryRepository,
      telegramAlertRepository,
      loadSubmissionContext,
      enqueuedTasks,
      recordedFailures,
      enqueuedAlerts,
      deps,
      sampleContext,
      setTime: (d: Date) => {
        currentTime = d;
      },
    };
  }

  describe('sheets_reconcile', () => {
    it('executes reconciliation and writes row when trackingId is not present', async () => {
      const { deps, spreadsheetRepository, store, setTime } = setup();
      const task: SubmissionTask = {
        id: 'task-1',
        submissionId: 'sub-dup-123',
        kind: 'sheets_reconcile',
        runAt: new Date('2026-11-06T12:03:20Z'),
        attempts: 1,
      };

      // Set uncertain state in store
      await store.recordAttemptStarted('sub-dup-123', new Date('2026-11-06T12:00:00Z'));
      await store.markUncertain('sub-dup-123', new Date('2026-11-06T12:03:20Z'), 'timeout');

      setTime(new Date('2026-11-06T12:03:25Z'));
      vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(0);

      await executeSheetsTask(deps, task);

      expect(spreadsheetRepository.countTrackingId).toHaveBeenCalledWith('sheet-1', 'Respuestas', 'sub-dup-123');
      expect(spreadsheetRepository.appendByHeaders).toHaveBeenCalledOnce();

      const record = await store.get('sub-dup-123');
      expect(record?.sheetWrittenAt).not.toBeNull();
    });

    it('a premature reconciliation does not write, read the sheet or burn an attempt (the rescheduled task will run it)', async () => {
      const { deps, spreadsheetRepository, store, setTime } = setup();
      const task: SubmissionTask = {
        id: 'task-early', submissionId: 'sub-dup-123', kind: 'sheets_reconcile',
        runAt: new Date('2026-11-06T12:03:20Z'), attempts: 1,
      };
      await store.recordAttemptStarted('sub-dup-123', new Date('2026-11-06T12:00:00Z'));
      await store.markUncertain('sub-dup-123', new Date('2026-11-06T12:06:40Z'), 'timeout');
      setTime(new Date('2026-11-06T12:03:25Z'));

      await expect(executeSheetsTask(deps, task)).resolves.toBeUndefined();

      expect(spreadsheetRepository.countTrackingId).not.toHaveBeenCalled();
      expect(spreadsheetRepository.appendByHeaders).not.toHaveBeenCalled();
    });

    it('throws when writeSubmissionToSheets returns uncertain error so worker can failTask and reschedule', async () => {
      const { deps, spreadsheetRepository, store, setTime } = setup();
      const task: SubmissionTask = {
        id: 'task-1',
        submissionId: 'sub-dup-123',
        kind: 'sheets_reconcile',
        runAt: new Date('2026-11-06T12:03:20Z'),
        attempts: 1,
      };

      await store.recordAttemptStarted('sub-dup-123', new Date('2026-11-06T12:00:00Z'));
      await store.markUncertain('sub-dup-123', new Date('2026-11-06T12:03:20Z'), 'timeout');

      setTime(new Date('2026-11-06T12:03:25Z'));
      vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(0);
      vi.mocked(spreadsheetRepository.appendByHeaders).mockRejectedValueOnce(new Error('Connection reset'));

      await expect(executeSheetsTask(deps, task)).rejects.toThrow('Connection reset');
    });
  });

  describe('sheets_recount', () => {
    it('does nothing when countTrackingId is exactly 1 (normal write confirmed)', async () => {
      const { deps, spreadsheetRepository, recoveryRepository } = setup();
      const task: SubmissionTask = {
        id: 'task-recount-1',
        submissionId: 'sub-dup-123',
        kind: 'sheets_recount',
        runAt: new Date('2026-11-06T12:18:20Z'),
        attempts: 1,
      };

      vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(1);

      await executeSheetsTask(deps, task);

      expect(spreadsheetRepository.countTrackingId).toHaveBeenCalledWith('sheet-1', 'Respuestas', 'sub-dup-123');
      expect(recoveryRepository.recordFailure).not.toHaveBeenCalled();
    });

    it('creates persistent case stage: "sheets_duplicate" and alerts by Telegram when countTrackingId > 1', async () => {
      const { deps, spreadsheetRepository, recoveryRepository, recordedFailures, enqueuedAlerts } = setup();
      const task: SubmissionTask = {
        id: 'task-recount-2',
        submissionId: 'sub-dup-123',
        kind: 'sheets_recount',
        runAt: new Date('2026-11-06T12:18:20Z'),
        attempts: 1,
      };

      // Aparece 2 veces (duplicado)
      vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(2);

      await executeSheetsTask(deps, task);

      expect(recoveryRepository.recordFailure).toHaveBeenCalledOnce();
      expect(recordedFailures[0]).toMatchObject({
        submissionId: 'sub-dup-123',
        targetId: 'davia-c11',
        stage: 'sheets_duplicate',
        safeError: expect.stringContaining('2 veces'),
        retentionDays: 7,
      });

      // Alerta de Telegram encolada para los chats configurados
      expect(enqueuedAlerts.length).toBe(2);
      expect(enqueuedAlerts[0]?.message).toContain('SHEETS_DUPLICATE');
      expect(enqueuedAlerts[0]?.message).toContain('sub-dup-123');
      expect(enqueuedAlerts[0]?.message).toContain('eliminar la fila sobrante en la planilla y marcar el caso como resuelto');
    });

    it('works even if the submission is already successful and an active case already existed', async () => {
      const { deps, spreadsheetRepository, recoveryRepository, recordedFailures } = setup();
      const task: SubmissionTask = {
        id: 'task-recount-3',
        submissionId: 'sub-dup-123',
        kind: 'sheets_recount',
        runAt: new Date('2026-11-06T14:03:20Z'),
        attempts: 1,
      };

      vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(3);

      await executeSheetsTask(deps, task);

      expect(recoveryRepository.recordFailure).toHaveBeenCalledOnce();
      expect(recordedFailures[0]?.stage).toBe('sheets_duplicate');
    });
  });

  describe('end-to-end plan scenario', () => {
    it('primer batch que se aplica DESPUÉS del conteo y de la inserción del segundo: el recuento a +15 min debe crear sheets_duplicate', async () => {
      const {
        deps,
        store,
        spreadsheetRepository,
        enqueuedTasks,
        recordedFailures,
        enqueuedAlerts,
        setTime,
      } = setup();

      // 1. Envío inicial a las 12:00:00 que termina sin confirmación (timeout de Google Sheets)
      const t0 = new Date('2026-11-06T12:00:00Z');
      setTime(t0);
      await store.recordAttemptStarted('sub-dup-123', t0);
      const nextAttemptAt = new Date('2026-11-06T12:03:20Z'); // t0 + 200 s
      await store.markUncertain('sub-dup-123', nextAttemptAt, 'ETIMEDOUT');
      await deps.tasks.enqueueTask({
        submissionId: 'sub-dup-123',
        kind: 'sheets_reconcile',
        runAt: nextAttemptAt,
      });

      // 2. A las 12:03:20 el worker de tareas ejecuta sheets_reconcile
      const t1 = new Date('2026-11-06T12:03:20Z');
      setTime(t1);

      // En este instante, Google Sheets todavía NO aplicó el primer batch (count = 0)
      vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(0);

      const reconcileTask: SubmissionTask = {
        id: 'task-rec-1',
        submissionId: 'sub-dup-123',
        kind: 'sheets_reconcile',
        runAt: nextAttemptAt,
        attempts: 1,
      };

      await executeSheetsTask(deps, reconcileTask);

      // Reconciliación insertó el segundo batch y encoló recuentos a +15 min y +2 h
      expect(spreadsheetRepository.appendByHeaders).toHaveBeenCalledOnce();
      const recount15m = enqueuedTasks.find(
        (t) => t.kind === 'sheets_recount' && t.runAt.getTime() === t1.getTime() + 15 * 60_000
      );
      expect(recount15m).toBeDefined();

      // 3. Entre 12:03:20 y 12:18:20, el primer batch demorado de Google se aplica en la hoja.
      // Ahora la columna tiene 2 filas con el mismo ID de seguimiento.

      // 4. A las 12:18:20 (t1 + 15 min), el worker ejecuta la tarea sheets_recount
      const t2 = new Date(t1.getTime() + 15 * 60_000);
      setTime(t2);

      vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(2);

      const recountTask: SubmissionTask = {
        id: 'task-recount-15m',
        submissionId: 'sub-dup-123',
        kind: 'sheets_recount',
        runAt: recount15m!.runAt,
        attempts: 1,
      };

      await executeSheetsTask(deps, recountTask);

      // Debe crear caso persistente 'sheets_duplicate' y alertar sin borrar nada
      expect(recordedFailures).toHaveLength(1);
      expect(recordedFailures[0]?.stage).toBe('sheets_duplicate');
      expect(recordedFailures[0]?.safeError).toContain('2 veces');

      expect(enqueuedAlerts.length).toBeGreaterThanOrEqual(1);
      expect(enqueuedAlerts[0]?.message).toContain('SHEETS_DUPLICATE');
      expect(enqueuedAlerts[0]?.message).toContain('eliminar la fila sobrante');
    });
  });

  describe('createSheetsTaskExecutors', () => {
    it('exports task executors for sheets_reconcile and sheets_recount matching sweepOnce TaskExecutors type', async () => {
      const { deps, spreadsheetRepository, store, setTime } = setup();
      const executors = createSheetsTaskExecutors(deps);

      expect(executors.sheets_reconcile).toBeTypeOf('function');
      expect(executors.sheets_recount).toBeTypeOf('function');

      // Test execution via executor wrapper
      setTime(new Date('2026-11-06T12:03:25Z'));
      await store.recordAttemptStarted('sub-dup-123', new Date('2026-11-06T12:00:00Z'));
      await store.markUncertain('sub-dup-123', new Date('2026-11-06T12:03:20Z'), 'timeout');
      vi.mocked(spreadsheetRepository.countTrackingId!).mockResolvedValueOnce(1); // Already present

      await executors.sheets_reconcile!({
        id: 't-1',
        submissionId: 'sub-dup-123',
        kind: 'sheets_reconcile',
        runAt: new Date('2026-11-06T12:03:20Z'),
        attempts: 1,
      });

      const record = await store.get('sub-dup-123');
      expect(record?.sheetWrittenAt).not.toBeNull();
    });
  });
});
