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

  it('fails clearly when the Drive root has not been configured', async () => {
    const repository = new MemoryTargetSpreadsheetRepository();
    const provisioner: SpreadsheetProvisioner = { create: vi.fn() };
    const service = new TargetSpreadsheetService(repository, provisioner, async () => null);

    await expect(service.ensureForTarget(target)).rejects.toThrow(
      'La carpeta raíz de Google Drive todavía no está configurada',
    );
    expect(provisioner.create).not.toHaveBeenCalled();
  });
});
