import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemorySubmissionRecoveryRepository } from '../infrastructure/database/in-memory-submission-recovery-repository.js';
import { InMemorySubmissionRepository } from '../infrastructure/database/in-memory-submission-repository.js';
import { FixtureAcademicCatalog } from '../infrastructure/fixtures/fixture-academic-catalog.js';
import { retryFailedSubmission } from './retry-failed-submission.js';

describe('retryFailedSubmission', () => {
  let recoveryRepo: InMemorySubmissionRecoveryRepository;
  let submissionRepo: InMemorySubmissionRepository;
  let catalog: FixtureAcademicCatalog;
  let mockFileStorage: {
    open: any;
    remove: any;
    save: any;
    cleanup: any;
  };
  let mockDrive: {
    storeSubmissionFiles: any;
  };
  let mockSpreadsheetRepo: {
    appendByHeaders: any;
  };
  let mockTargetSpreadsheetService: {
    ensureForTarget: any;
  };
  let mockNotificationRepo: any;

  beforeEach(() => {
    recoveryRepo = new InMemorySubmissionRecoveryRepository();
    submissionRepo = new InMemorySubmissionRepository();
    catalog = new FixtureAcademicCatalog();

    mockFileStorage = {
      open: vi.fn(async (token: string) => ({
        originalName: `file-${token}.pdf`,
        mimeType: 'application/pdf',
        data: Buffer.from('mock file data'),
        createdAt: new Date(),
      })),
      remove: vi.fn(async () => undefined),
      save: vi.fn(),
      cleanup: vi.fn(async () => 0),
    };

    mockDrive = {
      storeSubmissionFiles: vi.fn(async ({ files }: any) =>
        files.map((f: any) => ({
          token: f.token,
          driveFileId: `drive-${f.token}`,
        }))
      ),
    };

    mockSpreadsheetRepo = {
      appendByHeaders: vi.fn(async () => ({ rowUrl: 'https://sheets.google.com/test-row' })),
    };

    mockTargetSpreadsheetService = {
      ensureForTarget: vi.fn(async () => ({
        spreadsheetId: 'sheet-123',
        sheetName: 'Preinscripciones',
      })),
    };

    mockNotificationRepo = {
      ensureForSubmission: vi.fn(async () => undefined),
      enqueue: vi.fn(async () => ({ id: 'notif-1' })),
    };
  });

  it('successfully retries a submission failed at the sheets stage', async () => {
    const subRecord = await recoveryRepo.recordFailure({
      submissionId: 'sub_sheets_failed',
      targetId: 'diplomado-salud-c2',
      stage: 'sheets',
      safeError: 'Error al conectar con Google Sheets.',
      retentionDays: 7,
    });

    recoveryRepo.setDetails(subRecord.id, {
      values: {
        nombres: 'María',
        apellidos: 'Rodríguez',
        email: 'maria@example.com',
        cedula: '12345678',
      },
      files: [],
    });

    const result = await retryFailedSubmission({
      recoveryIdOrSubmissionId: subRecord.id,
      adminEmail: 'admin@flacso.edu.uy',
    }, {
      recoveryRepository: recoveryRepo,
      submissionRepository: submissionRepo,
      catalog,
      spreadsheetDependencies: {
        targetSpreadsheetService: mockTargetSpreadsheetService as any,
        repository: mockSpreadsheetRepo as any,
      },
      notificationDependencies: {
        repository: mockNotificationRepo,
      },
    });

    expect(result.ok).toBe(true);
    expect(mockTargetSpreadsheetService.ensureForTarget).toHaveBeenCalledTimes(1);
    expect(mockSpreadsheetRepo.appendByHeaders).toHaveBeenCalledTimes(1);

    const updated = await recoveryRepo.findById(subRecord.id);
    expect(updated?.status).toBe('resolved');
    expect(updated?.resolvedAt).toBeInstanceOf(Date);
  });

  it('skips already-stored drive files and only uploads pending files', async () => {
    const subRecord = await recoveryRepo.recordFailure({
      submissionId: 'sub_drive_partial',
      targetId: 'diplomado-salud-c2',
      stage: 'drive',
      safeError: 'Fallo al subir segundo archivo a Drive.',
      retentionDays: 7,
    });

    recoveryRepo.setDetails(subRecord.id, {
      values: {
        nombres: 'Juan',
        apellidos: 'Pérez',
        email: 'juan@example.com',
      },
      files: [
        {
          token: 'tok_already_stored',
          fieldKey: 'titulo',
          originalName: 'titulo.pdf',
          size: 1024,
          mimeType: 'application/pdf',
          status: 'success',
          driveFileId: 'drive-existing-123',
        },
        {
          token: 'tok_pending',
          fieldKey: 'cedula_identidad',
          originalName: 'cedula.pdf',
          size: 2048,
          mimeType: 'application/pdf',
          status: 'pending',
        },
      ],
    });

    const result = await retryFailedSubmission({
      recoveryIdOrSubmissionId: subRecord.id,
      adminEmail: 'admin@flacso.edu.uy',
    }, {
      recoveryRepository: recoveryRepo,
      submissionRepository: submissionRepo,
      catalog,
      fileDependencies: {
        storage: mockFileStorage as any,
        drive: mockDrive as any,
      },
      spreadsheetDependencies: {
        targetSpreadsheetService: mockTargetSpreadsheetService as any,
        repository: mockSpreadsheetRepo as any,
      },
    });

    expect(result.ok).toBe(true);
    // Only tok_pending was opened from temporary storage
    expect(mockFileStorage.open).toHaveBeenCalledTimes(1);
    expect(mockFileStorage.open).toHaveBeenCalledWith('tok_pending');
    // Drive storeSubmissionFiles was called with only 1 file
    expect(mockDrive.storeSubmissionFiles).toHaveBeenCalledTimes(1);
    const storeCall = mockDrive.storeSubmissionFiles.mock.calls[0][0];
    expect(storeCall.files).toHaveLength(1);
    expect(storeCall.files[0].token).toBe('tok_pending');
    // Sheets was called exactly once
    expect(mockSpreadsheetRepo.appendByHeaders).toHaveBeenCalledTimes(1);
    // Cleaned up both files
    expect(mockFileStorage.remove).toHaveBeenCalledWith('tok_already_stored');
    expect(mockFileStorage.remove).toHaveBeenCalledWith('tok_pending');
  });

  it('fails with MISSING_FILE and updates recovery when temporary file is missing or expired', async () => {
    const subRecord = await recoveryRepo.recordFailure({
      submissionId: 'sub_missing_file',
      targetId: 'diplomado-salud-c2',
      stage: 'drive',
      safeError: 'Fallo al subir a Drive.',
      retentionDays: 7,
    });

    recoveryRepo.setDetails(subRecord.id, {
      values: { nombres: 'Ana' },
      files: [
        {
          token: 'tok_expired',
          fieldKey: 'curriculum',
          originalName: 'cv_ana.pdf',
          size: 512,
          mimeType: 'application/pdf',
          status: 'failed',
        },
      ],
    });

    mockFileStorage.open.mockRejectedValueOnce(new Error('Acceso no autorizado o archivo expirado'));

    const result = await retryFailedSubmission({
      recoveryIdOrSubmissionId: subRecord.id,
      adminEmail: 'admin@flacso.edu.uy',
    }, {
      recoveryRepository: recoveryRepo,
      submissionRepository: submissionRepo,
      catalog,
      fileDependencies: {
        storage: mockFileStorage as any,
        drive: mockDrive as any,
      },
      spreadsheetDependencies: {
        targetSpreadsheetService: mockTargetSpreadsheetService as any,
        repository: mockSpreadsheetRepo as any,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('MISSING_FILE');
      expect(result.message).toContain('cv_ana.pdf');
      expect(result.message).toContain('curriculum');
    }

    const updated = await recoveryRepo.findById(subRecord.id);
    expect(updated?.status).toBe('pending');
    expect(updated?.attemptCount).toBe(2);
    expect(updated?.safeError).toContain('cv_ana.pdf');
  });

  it('rejects concurrent retry when recovery is actively locked by another worker', async () => {
    const now = new Date();
    const subRecord = await recoveryRepo.recordFailure({
      submissionId: 'sub_locked',
      targetId: 'diplomado-salud-c2',
      stage: 'sheets',
      safeError: 'Sheets error',
      retentionDays: 7,
      now,
    });

    // Claim first by worker A
    await recoveryRepo.claim(subRecord.id, now, 60000, 'worker-a@flacso.edu.uy');

    // Attempt retry by admin B while lock is active
    const result = await retryFailedSubmission({
      recoveryIdOrSubmissionId: subRecord.id,
      adminEmail: 'admin-b@flacso.edu.uy',
      now,
    }, {
      recoveryRepository: recoveryRepo,
      submissionRepository: submissionRepo,
      catalog,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONCURRENT_CLAIM');
    }
  });

  it('rejects retry on an already resolved recovery case', async () => {
    const subRecord = await recoveryRepo.recordFailure({
      submissionId: 'sub_resolved',
      targetId: 'diplomado-salud-c2',
      stage: 'sheets',
      safeError: 'Original error',
    });

    await recoveryRepo.markRetryResult(subRecord.id, { success: true });

    const result = await retryFailedSubmission({
      recoveryIdOrSubmissionId: subRecord.id,
      adminEmail: 'admin@flacso.edu.uy',
    }, {
      recoveryRepository: recoveryRepo,
      submissionRepository: submissionRepo,
      catalog,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ALREADY_RESOLVED');
    }
  });

  it('rejects retry on an already discarded recovery case', async () => {
    const subRecord = await recoveryRepo.recordFailure({
      submissionId: 'sub_discarded',
      targetId: 'diplomado-salud-c2',
      stage: 'sheets',
      safeError: 'Original error',
    });

    await recoveryRepo.discard(subRecord.id, 'admin@flacso.edu.uy', 'Duplicado');

    const result = await retryFailedSubmission({
      recoveryIdOrSubmissionId: subRecord.id,
      adminEmail: 'admin@flacso.edu.uy',
    }, {
      recoveryRepository: recoveryRepo,
      submissionRepository: submissionRepo,
      catalog,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ALREADY_DISCARDED');
    }
  });
});
