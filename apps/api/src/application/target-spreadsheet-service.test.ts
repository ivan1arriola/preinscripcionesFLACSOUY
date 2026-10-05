import { describe, expect, it, vi } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import {
  TargetSpreadsheetService,
  type SpreadsheetProvisioner,
} from './target-spreadsheet-service.js';
import type {
  TargetSpreadsheetConfiguration,
  TargetSpreadsheetRepository,
} from '../ports/target-spreadsheet-repository.js';

const target: AcademicTarget = {
  id: 'maestria-c1',
  kind: 'academic_offer',
  title: 'Maestría en Educación — Cohorte 1',
  offerType: 'maestria',
  registrationOpen: true,
  configRevision: 'maestria-c1-v1',
  orientations: [],
  mentions: [],
};

class MemoryTargetSpreadsheetRepository implements TargetSpreadsheetRepository {
  private readonly records = new Map<string, TargetSpreadsheetConfiguration>();

  async ensureTarget(_target: AcademicTarget): Promise<void> {}

  async get(targetId: string): Promise<TargetSpreadsheetConfiguration | null> {
    return this.records.get(targetId) ?? null;
  }

  async list(): Promise<TargetSpreadsheetConfiguration[]> {
    return [...this.records.values()];
  }

  async save(configuration: TargetSpreadsheetConfiguration): Promise<void> {
    this.records.set(configuration.targetId, configuration);
  }
}

describe('TargetSpreadsheetService', () => {
  it('creates and persists one spreadsheet per target without requiring an ID', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    const provisioner: SpreadsheetProvisioner = {
      create: vi.fn().mockResolvedValue({
        spreadsheetId: 'created-sheet-1',
        sheetName: 'Sheet1',
        url: 'https://docs.google.com/spreadsheets/d/created-sheet-1/edit',
      }),
    };
    const service = new TargetSpreadsheetService(
      repository,
      provisioner,
      async () => 'drive-root-1',
    );

    const created = await service.ensureForTarget(target);
    const reused = await service.ensureForTarget(target);

    expect(created.spreadsheetId).toBe('created-sheet-1');
    expect(reused).toEqual(created);
    expect(provisioner.create).toHaveBeenCalledTimes(1);
    expect(provisioner.create).toHaveBeenCalledWith(expect.objectContaining({
      title: target.title,
      folderId: 'drive-root-1',
    }));
  });

  it('unlinks a spreadsheet without deleting it and creates a new one on the next preparation', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    await repository.save({ targetId: target.id, spreadsheetId: 'old-sheet', sheetName: 'Inscripciones', status: 'created' });
    const setProperties = vi.fn().mockResolvedValue(undefined);
    const provisioner: SpreadsheetProvisioner = { create: vi.fn().mockResolvedValue({ spreadsheetId: 'new-sheet', sheetName: 'Inscripciones' }) };
    const service = new TargetSpreadsheetService(repository, provisioner, async () => 'root-1', {
      findByTargetId: vi.fn().mockResolvedValue({ targetId: target.id, spreadsheetId: 'old-sheet', sheetName: 'Inscripciones', parentFolderId: 'folder', url: 'https://old' }),
      ensureTargetFolder: vi.fn().mockResolvedValue('folder'),
      setSpreadsheetAppProperties: setProperties,
    } as any);

    const detached = await service.unlinkForTarget(target.id);
    expect(detached.status).toBe('detached');
    expect(detached.spreadsheetId).toBe('old-sheet');
    expect(setProperties).toHaveBeenCalledWith('old-sheet', expect.objectContaining({ flacsoDetached: 'true' }));
    const prepared = await service.ensureForTarget(target);
    expect(prepared.spreadsheetId).toBe('new-sheet');
    expect(provisioner.create).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when the Drive root has not been configured', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    const provisioner: SpreadsheetProvisioner = { create: vi.fn() };
    const service = new TargetSpreadsheetService(repository, provisioner, async () => null);

    await expect(service.ensureForTarget(target)).rejects.toThrow(
      'La carpeta raíz de Google Drive todavía no está configurada',
    );
    expect(provisioner.create).not.toHaveBeenCalled();
  });

  it('reconciles and relocates a spreadsheet when the Drive root folder changes, instead of returning the old association blindly', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    // Simulate old association pointing to an old root
    await repository.save({
      targetId: target.id,
      spreadsheetId: 'sheet-old-root',
      sheetName: 'Inscripciones',
      url: 'https://docs.google.com/spreadsheets/d/sheet-old-root/edit',
      rootFolderId: 'old-root-1',
      status: 'created',
    });

    const moveSpreadsheet = vi.fn().mockResolvedValue(undefined);
    const discoveryPort = {
      findByTargetId: vi.fn().mockResolvedValue({
        targetId: target.id,
        spreadsheetId: 'sheet-old-root',
        sheetName: 'Inscripciones',
        parentFolderId: 'old-target-folder',
        url: 'https://docs.google.com/spreadsheets/d/sheet-old-root/edit',
      }),
      ensureTargetFolder: vi.fn().mockResolvedValue('new-target-folder-in-new-root'),
      moveToTargetFolder: vi.fn(),
      moveSpreadsheet,
    };

    const provisioner: SpreadsheetProvisioner = { create: vi.fn() };
    const service = new TargetSpreadsheetService(
      repository,
      provisioner,
      async () => 'new-root-2',
      discoveryPort as any,
    );

    const result = await service.ensureForTarget(target);

    // It should have queried Drive discovery
    expect(discoveryPort.findByTargetId).toHaveBeenCalledWith('new-root-2', target.id);
    // It should have ensured target folder in new root
    expect(discoveryPort.ensureTargetFolder).toHaveBeenCalledWith('new-root-2', target);
    // It should have moved spreadsheet to new target folder
    expect(moveSpreadsheet).toHaveBeenCalledWith('sheet-old-root', 'old-target-folder', 'new-target-folder-in-new-root');
    // Provisioner was NOT called (no duplicates)
    expect(provisioner.create).not.toHaveBeenCalled();
    // Returned configuration reflects reconciliation
    expect(result.spreadsheetId).toBe('sheet-old-root');
    expect(result.rootFolderId).toBe('new-root-2');
    expect(result.status).toBe('reconciled');

    // Local repository was updated
    const stored = await repository.get(target.id);
    expect(stored?.rootFolderId).toBe('new-root-2');
    expect(stored?.status).toBe('reconciled');
  });

  it('finds a pre-existing spreadsheet in Drive without an existing DB record and relocates it without creating duplicates', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    const moveSpreadsheet = vi.fn().mockResolvedValue(undefined);
    const discoveryPort = {
      findByTargetId: vi.fn().mockResolvedValue({
        targetId: target.id,
        spreadsheetId: 'sheet-found-in-drive',
        sheetName: 'Inscripciones',
        parentFolderId: 'somewhere-else',
        url: 'https://docs.google.com/spreadsheets/d/sheet-found-in-drive/edit',
      }),
      ensureTargetFolder: vi.fn().mockResolvedValue('target-folder-id'),
      moveSpreadsheet,
    };

    const provisioner: SpreadsheetProvisioner = { create: vi.fn() };
    const service = new TargetSpreadsheetService(
      repository,
      provisioner,
      async () => 'current-root',
      discoveryPort as any,
    );

    const result = await service.ensureForTarget(target);

    expect(result.spreadsheetId).toBe('sheet-found-in-drive');
    expect(provisioner.create).not.toHaveBeenCalled();
    expect(moveSpreadsheet).toHaveBeenCalledWith('sheet-found-in-drive', 'somewhere-else', 'target-folder-id');
    expect(await repository.get(target.id)).not.toBeNull();
  });

  it('identifies the spreadsheet by targetId even if the target title was renamed', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    const discoveryPort = {
      findByTargetId: vi.fn().mockResolvedValue({
        targetId: target.id,
        spreadsheetId: 'sheet-same-target-id',
        sheetName: 'Inscripciones',
        parentFolderId: 'target-folder-id',
        url: 'https://docs.google.com/spreadsheets/d/sheet-same-target-id/edit',
      }),
      ensureTargetFolder: vi.fn().mockResolvedValue('target-folder-id'),
    };

    const provisioner: SpreadsheetProvisioner = { create: vi.fn() };
    const service = new TargetSpreadsheetService(
      repository,
      provisioner,
      async () => 'root-1',
      discoveryPort as any,
    );

    const renamedTarget = { ...target, title: 'Nombre Completamente Distinto' };
    const result = await service.ensureForTarget(renamedTarget);

    expect(result.spreadsheetId).toBe('sheet-same-target-id');
    expect(discoveryPort.findByTargetId).toHaveBeenCalledWith('root-1', target.id);
    expect(provisioner.create).not.toHaveBeenCalled();
  });

  it('marks target as blocked and does not update local DB when moving spreadsheet fails with Drive permission error', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    await repository.save({
      targetId: target.id,
      spreadsheetId: 'sheet-perm-error',
      sheetName: 'Inscripciones',
      url: 'https://docs.google.com/spreadsheets/d/sheet-perm-error/edit',
      rootFolderId: 'old-root-1',
      status: 'created',
    });

    const forbiddenError = new Error('Google Drive no permitió mover la planilla (HTTP 403).');
    (forbiddenError as any).code = 'DRIVE_MOVE_FORBIDDEN';

    const discoveryPort = {
      findByTargetId: vi.fn().mockResolvedValue({
        targetId: target.id,
        spreadsheetId: 'sheet-perm-error',
        sheetName: 'Inscripciones',
        parentFolderId: 'old-folder',
        url: 'https://docs.google.com/spreadsheets/d/sheet-perm-error/edit',
      }),
      ensureTargetFolder: vi.fn().mockResolvedValue('new-target-folder'),
      moveSpreadsheet: vi.fn().mockRejectedValue(forbiddenError),
    };

    const service = new TargetSpreadsheetService(
      repository,
      { create: vi.fn() },
      async () => 'new-root-2',
      discoveryPort as any,
    );

    await expect(service.ensureForTarget(target)).rejects.toThrow(/Google Drive no permitió mover/);

    // Stored association must not be marked as reconciled to new-root-2
    const stored = await repository.get(target.id);
    expect(stored?.rootFolderId).not.toBe('new-root-2');
  });

  it('handles concurrent calls for the same target by creating the spreadsheet exactly once', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    let resolveCreate: (val: any) => void;
    const createPromise = new Promise((resolve) => {
      resolveCreate = resolve;
    });

    const provisioner: SpreadsheetProvisioner = {
      create: vi.fn().mockImplementation(() => createPromise),
    };

    const discoveryPort = {
      findByTargetId: vi.fn().mockResolvedValue(null),
      ensureTargetFolder: vi.fn().mockResolvedValue('target-folder-id'),
    };

    const service = new TargetSpreadsheetService(
      repository,
      provisioner,
      async () => 'root-1',
      discoveryPort as any,
    );

    const call1 = service.ensureForTarget(target);
    const call2 = service.ensureForTarget(target);

    resolveCreate!({
      spreadsheetId: 'concurrent-sheet-1',
      sheetName: 'Inscripciones',
      url: 'https://docs.google.com/spreadsheets/d/concurrent-sheet-1/edit',
    });

    const [res1, res2] = await Promise.all([call1, call2]);

    expect(res1.spreadsheetId).toBe('concurrent-sheet-1');
    expect(res2.spreadsheetId).toBe('concurrent-sheet-1');
    expect(provisioner.create).toHaveBeenCalledTimes(1);
  });

  it('reconcileTargets reconciles targets and returns status completed or blocked', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    const service = new TargetSpreadsheetService(
      repository,
      {
        create: vi.fn().mockResolvedValue({
          spreadsheetId: 'created-target-1',
          sheetName: 'Inscripciones',
        }),
      },
      async () => 'root-1',
    );

    const result = await service.reconcileTargets([target]);
    expect(result.status).toBe('completed');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.targetId).toBe(target.id);
    expect(result.targets[0]?.status).toBe('created');
  });
});
