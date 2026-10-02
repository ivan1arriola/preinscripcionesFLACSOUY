import { describe, it, expect, vi } from 'vitest';
import { AdminService } from './admin-service.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import type { DriveRepository } from '../../ports/drive-repository.js';
import type { SystemErrorRepository } from '../../ports/system-error-repository.js';
import type { AcademicTarget } from '@flacso/contracts';

describe('AdminService', () => {
  const sampleTarget: AcademicTarget = {
    id: 'diplomado-sociedad',
    kind: 'academic_offer',
    title: 'Diploma en Sociedad',
    registrationOpen: true,
    configRevision: 'rev-1',
    form: {
      valid: true,
      inputs: [
        { key: 'email', required: true },
        { key: 'nombre', required: true },
      ],
      issues: [],
    },
    orientations: [],
  };

  const mockCatalog: AcademicCatalog = {
    listTargets: vi.fn().mockResolvedValue([sampleTarget]),
    getTarget: vi.fn().mockImplementation(async (id: string) =>
      id === 'diplomado-sociedad' ? sampleTarget : null
    ),
    revalidateTarget: vi.fn().mockResolvedValue(sampleTarget),
  };

  const mockSheetsRepo: SpreadsheetRepository = {
    readHeaders: vi.fn(),
    appendByHeaders: vi.fn(),
    diagnose: vi.fn().mockResolvedValue({
      spreadsheetId: 'sheet-123',
      accessible: true,
      sheetFound: true,
      headerDiagnostic: {
        valid: true,
        foundColumns: ['email', 'nombre', 'observaciones'],
        missingColumns: [],
        extraColumns: ['observaciones'],
      },
    }),
  };

  const mockDriveRepo: DriveRepository = {
    resolveTargetFolders: vi.fn().mockResolvedValue({
      targetFolderId: 'folder-target-1',
      documentsFolderId: 'folder-docs-1',
    }),
    uploadDocument: vi.fn(),
  };

  const mockErrorRepo: SystemErrorRepository = {
    save: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'err-1',
        severity: 'high',
        origin: 'sheets',
        code: 'COL_ERR',
        message: 'Column missing',
        context: {},
        status: 'unresolved',
        createdAt: '2026-10-02T10:00:00Z',
        updatedAt: '2026-10-02T10:00:00Z',
      },
    ]),
    resolve: vi.fn().mockResolvedValue({
      id: 'err-1',
      status: 'resolved',
      resolvedBy: 'admin',
    }),
  };

  it('lists detected targets with basic diagnostic status', async () => {
    const service = new AdminService({ catalog: mockCatalog });
    const targets = await service.listTargets();

    expect(targets).toHaveLength(1);
    expect(targets[0]!.id).toBe('diplomado-sociedad');
    expect(targets[0]!.status).toBe('operational');
  });

  it('performs deep diagnostic on a target with WordPress and Drive checks', async () => {
    const service = new AdminService({
      catalog: mockCatalog,
      driveRepo: mockDriveRepo,
    });

    const diag = await service.diagnoseTarget('diplomado-sociedad');
    expect(diag.targetId).toBe('diplomado-sociedad');
    expect(diag.status).toBe('healthy');
    expect(diag.wordpress.valid).toBe(true);
    expect(diag.drive.status).toBe('ok');
    expect(diag.drive.targetFolderId).toBe('folder-target-1');
  });

  it('handles non-existent targets gracefully', async () => {
    const service = new AdminService({ catalog: mockCatalog });
    const diag = await service.diagnoseTarget('non-existent');

    expect(diag.status).toBe('error');
    expect(diag.wordpress.status).toBe('error');
    expect(diag.wordpress.issues[0]).toContain('no encontrado');
  });

  it('lists and resolves system errors', async () => {
    const service = new AdminService({
      catalog: mockCatalog,
      errorRepo: mockErrorRepo,
    });

    const errors = await service.listErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe('err-1');

    const resolved = await service.resolveError('err-1', 'test-admin');
    expect(resolved?.status).toBe('resolved');
    expect(mockErrorRepo.resolve).toHaveBeenCalledWith('err-1', 'test-admin', expect.any(Date));
  });

  it('reports integration health accurately', async () => {
    const service = new AdminService({
      catalog: mockCatalog,
      driveRepo: mockDriveRepo,
      spreadsheetRepo: mockSheetsRepo,
      checkDatabase: vi.fn().mockResolvedValue(true),
    });

    const health = await service.checkIntegrationsHealth();
    expect(health.status).toBe('healthy');
    expect(health.integrations.database.status).toBe('healthy');
    expect(health.integrations.wordpress.status).toBe('healthy');
    expect(health.integrations.googleSheets.status).toBe('healthy');
    expect(health.integrations.googleDrive.status).toBe('healthy');
  });
});
