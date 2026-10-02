import { describe, it, expect, vi } from 'vitest';
import { submitWithDocuments } from './submit-with-documents.js';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SubmissionRepository } from '../ports/submission-repository.js';
import type { SpreadsheetRepository } from '../ports/spreadsheet-repository.js';
import type { DriveRepository } from '../ports/drive-repository.js';
import type { TemporaryFileStorage } from '../ports/temporary-file-storage.js';

describe('SubmitWithDocuments Use Case (Complete Document & Sheets Flow)', () => {
  const mockTarget = {
    id: 'davia-c11',
    kind: 'academic_offer' as const,
    title: 'Diploma Superior en DAVIA',
    registrationOpen: true,
    registrationWindow: { from: null, until: null },
    configRevision: 'rev-123',
    form: {
      valid: true,
      inputs: [
        { key: 'documento', position: 10, required: true },
        { key: 'orientacion', position: 20, required: true },
      ],
      issues: [],
    },
    orientations: [
      {
        id: 'educacion',
        name: 'Educación',
        mentions: [{ id: 'tec-edu', name: 'Tecnología Educativa' }],
      },
    ],
  };

  const validValues = {
    nombre: 'Valeria',
    apellido: 'Suárez',
    email: 'valeria@example.com',
    telefono: '099000111',
    documento: '4.123.456-7',
    orientacion: 'educacion',
    mencion: 'tec-edu',
  };

  it('completes the entire flow: validates, uploads to Drive, appends to Sheets, saves to Postgres, and deletes temp session', async () => {
    const catalog: AcademicCatalog = {
      listTargets: vi.fn(),
      getTarget: vi.fn(),
      revalidateTarget: vi.fn().mockResolvedValue(mockTarget),
    };

    const submissionRepo: SubmissionRepository = {
      save: vi.fn().mockResolvedValue({ id: 'sub_xyz789' }),
    };

    const spreadsheetRepo: SpreadsheetRepository = {
      readHeaders: vi.fn(),
      appendByHeaders: vi.fn().mockResolvedValue({
        spreadsheetId: 'sheet_1',
        updatedRange: 'Sheet1!A2:H2',
        updatedRows: 1,
      }),
      diagnose: vi.fn(),
    };

    const driveRepo: DriveRepository = {
      resolveTargetFolders: vi.fn().mockResolvedValue({
        targetFolderId: 'folder_target',
        documentsFolderId: 'folder_docs',
      }),
      uploadDocument: vi.fn().mockResolvedValue({
        fileId: 'drive_file_1',
        webViewLink: 'https://drive.google.com/file/d/drive_file_1/view',
      }),
    };

    const tempStorage: TemporaryFileStorage = {
      createSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue({
        id: 'sess_1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        files: [
          {
            id: 'f1',
            originalName: 'cedula.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            uploadedAt: new Date(),
          },
        ],
      }),
      storeFile: vi.fn(),
      getFile: vi.fn().mockResolvedValue({
        info: {
          id: 'f1',
          originalName: 'cedula.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          uploadedAt: new Date(),
        },
        buffer: Buffer.from('dummy content'),
      }),
      deleteFile: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      cleanupExpiredSessions: vi.fn(),
    };

    const result = await submitWithDocuments({
      targetId: 'davia-c11',
      configRevision: 'rev-123',
      values: validValues,
      sessionId: 'sess_1',
      spreadsheetId: 'sheet_1',
      catalog,
      submissionRepo,
      spreadsheetRepo,
      driveRepo,
      tempStorage,
    });

    expect(result.submissionId).toBe('sub_xyz789');
    expect(result.documentLinks).toEqual([
      'https://drive.google.com/file/d/drive_file_1/view',
    ]);

    // Verify order of calls:
    // 1. Drive upload was called with document folder
    expect(driveRepo.uploadDocument).toHaveBeenCalledWith(
      'folder_docs',
      'cedula.pdf',
      'application/pdf',
      expect.any(Buffer)
    );

    // 2. Sheets was called with values
    expect(spreadsheetRepo.appendByHeaders).toHaveBeenCalled();

    // 3. Postgres saved submission
    expect(submissionRepo.save).toHaveBeenCalled();

    // 4. Temporary session was purged
    expect(tempStorage.deleteSession).toHaveBeenCalledWith('sess_1');
  });

  it('rejects submission if Drive upload fails without writing to Sheets or deleting session prematurely', async () => {
    const catalog: AcademicCatalog = {
      listTargets: vi.fn(),
      getTarget: vi.fn(),
      revalidateTarget: vi.fn().mockResolvedValue(mockTarget),
    };
    const submissionRepo: SubmissionRepository = { save: vi.fn() };
    const spreadsheetRepo: SpreadsheetRepository = {
      readHeaders: vi.fn(),
      appendByHeaders: vi.fn(),
      diagnose: vi.fn(),
    };
    const driveRepo: DriveRepository = {
      resolveTargetFolders: vi.fn().mockResolvedValue({
        targetFolderId: 'f_target',
        documentsFolderId: 'f_docs',
      }),
      uploadDocument: vi.fn().mockRejectedValue(new Error('Drive quota exceeded')),
    };
    const tempStorage: TemporaryFileStorage = {
      createSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue({
        id: 'sess_1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        files: [
          {
            id: 'f1',
            originalName: 'cedula.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            uploadedAt: new Date(),
          },
        ],
      }),
      storeFile: vi.fn(),
      getFile: vi.fn().mockResolvedValue({
        info: {
          id: 'f1',
          originalName: 'cedula.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          uploadedAt: new Date(),
        },
        buffer: Buffer.from('dummy content'),
      }),
      deleteFile: vi.fn(),
      deleteSession: vi.fn(),
      cleanupExpiredSessions: vi.fn(),
    };

    await expect(
      submitWithDocuments({
        targetId: 'davia-c11',
        configRevision: 'rev-123',
        values: validValues,
        sessionId: 'sess_1',
        spreadsheetId: 'sheet_1',
        catalog,
        submissionRepo,
        spreadsheetRepo,
        driveRepo,
        tempStorage,
      })
    ).rejects.toThrow('Drive quota exceeded');

    expect(spreadsheetRepo.appendByHeaders).not.toHaveBeenCalled();
    expect(submissionRepo.save).not.toHaveBeenCalled();
    expect(tempStorage.deleteSession).not.toHaveBeenCalled();
  });
});
