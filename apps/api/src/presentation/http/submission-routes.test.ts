import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { MemoryFormProfileRepository } from '../../infrastructure/fixtures/memory-form-profile-repository.js';
import { getTargetForm } from '../../application/get-target-form.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import { InMemoryEmailNotificationRepository } from '../../infrastructure/database/in-memory-email-notification-repository.js';

describe('Submission HTTP Routes', () => {
  let server: Server;
  let baseUrl: string;
  let repository: InMemorySubmissionRepository;
  let notificationRepository: InMemoryEmailNotificationRepository;

  const validPayload = {
    configRevision: 'davia-c11-v1',
    values: {
      nombre1: 'Lucía',
      nombre2: '',
      apellido1: 'Méndez',
      apellido2: '',
      email: 'lucia@example.com',
      fechaNacimiento: '1992-03-20',
      tipoDocumento: 'cedula_uruguaya',
      documento: '34567894',
      paisEmisorDocumento: 'Uruguay',
      genero: 'Mujer',
      etnia: 'No declara',
      celular: '+59899123456',
      ciudadResidencia: 'Montevideo',
      domicilio: 'Montevideo',
      ocupacion: 'Docente',
      paisNacimiento: 'Uruguay',
      paisResidencia: 'Uruguay',
      tieneConvenio: 'No',
      fuente: 'Web',
      aceptaDifusion: 'No',
      estudios: 'Profesorado',
      posgradoFlacso: 'No',
      posgradoCual: '',
      orientacion: 'Educación',
      mencion: 'Tecnología Educativa',
      tituloDenominacion: 'Profesora de Historia',
      sinTituloActual: 'No',
      institucion: 'Universidad de la República',
    },
    files: [
      { fieldKey: 'identidad', token: 'tok_id', originalName: 'cedula.pdf', mimeType: 'application/pdf', size: 1024 },
      { fieldKey: 'cv', token: 'tok_cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 1024 },
      { fieldKey: 'titulo', token: 'tok_tit', originalName: 'titulo.pdf', mimeType: 'application/pdf', size: 1024 },
      { fieldKey: 'cartaMotivacion', token: 'tok_mot', originalName: 'carta.pdf', mimeType: 'application/pdf', size: 1024 },
    ],
  };

  beforeAll(async () => {
    const catalog = new FixtureAcademicCatalog();
    repository = new InMemorySubmissionRepository();
    const profileRepo = new MemoryFormProfileRepository();
    const formResult = await getTargetForm(catalog, profileRepo, 'davia-c11');
    if (!formResult.ok) throw new Error(formResult.message);
    validPayload.configRevision = formResult.form.effectiveRevision;
    const storage: TemporaryFileStoragePort = {
      save: async () => ({ token: 'unused', sessionId: 'sess-1', fieldKey: 'identidad', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
      open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
      remove: async () => undefined,
      cleanup: async () => 0,
    };
    const drive: GoogleDriveRepositoryPort = {
      storeSubmissionFiles: async () => ({
        files: [
          { token: 'tok_id', driveFileId: 'drive-1' },
          { token: 'tok_cv', driveFileId: 'drive-2' },
          { token: 'tok_tit', driveFileId: 'drive-3' },
          { token: 'tok_mot', driveFileId: 'drive-4' },
        ],
        documentsFolderId: 'folder-1',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
      }),
    };
    notificationRepository = new InMemoryEmailNotificationRepository();
    const app = createApp({
      catalog,
      repository,
      formProfileRepository: profileRepo,
      temporaryFileStorage: storage,
      googleDriveRepository: drive,
      emailNotificationRepository: notificationRepository,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /api/targets/:id/submissions returns 201 with submissionId for valid submission', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-preinscription-session': 'session-test',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.submissionId).toBeDefined();
    expect(data.submissionId).toMatch(/^sub_/);

    const queuedNotifications = await notificationRepository.listNotifications({ submissionId: data.submissionId });
    expect(queuedNotifications.length).toBeGreaterThan(0);
    const applicantNotif = queuedNotifications.find((n) => n.audience === 'applicant');
    expect(applicantNotif).toBeDefined();
    expect(applicantNotif?.recipientEmail).toBe('lucia@example.com');
    expect(applicantNotif?.payload.documentsFolderUrl).toBe('https://drive.google.com/drive/folders/folder-1');
  });

  it('POST /api/targets/:id/submissions returns 409 when target is closed', async () => {
    const res = await fetch(`${baseUrl}/api/targets/mg-c8/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configRevision: 'mg-c8-v1',
        values: validPayload.values,
      }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error.code).toBe('CLOSED');
  });

  it('POST /api/targets/:id/submissions returns 409 for stale revision', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configRevision: 'stale-rev-00',
        values: validPayload.values,
      }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error.code).toBe('STALE_REVISION');
  });

  it('POST /api/targets/:id/submissions returns 400 for field validation error', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configRevision: validPayload.configRevision,
        values: {
          ...validPayload.values,
          email: 'correo-invalido',
        },
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.fieldErrors.email).toBeDefined();
  });

  it('POST /api/targets/:id/submissions returns 404 for unknown target', async () => {
    const res = await fetch(`${baseUrl}/api/targets/target-no-existe/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('POST /api/targets/:id/submissions returns 400 for malformed payload', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: 'not an object' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('INVALID_REQUEST');
  });

  it('ensures error responses never leak connection strings or secrets', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: 'invalid' }),
    });

    const text = await res.text();
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('password');
    expect(text).not.toContain('secret');
  });

  describe('Notification enqueuing & order of operations', () => {
    it('executes in strict order: saveOrGet, Drive, Sheets, markProcessing(success), and ensureForSubmission', async () => {
      const order: string[] = [];
      const catalog = new FixtureAcademicCatalog();
      const profileRepo = new MemoryFormProfileRepository();
      const testRepo = new InMemorySubmissionRepository();
      const originalSaveOrGet = testRepo.saveOrGet.bind(testRepo);
      testRepo.saveOrGet = async (cmd) => {
        order.push('saveOrGet');
        return originalSaveOrGet(cmd);
      };
      const originalMarkProcessing = testRepo.markProcessing.bind(testRepo);
      testRepo.markProcessing = async (id, status, error) => {
        order.push(`markProcessing:${status}`);
        return originalMarkProcessing(id, status, error);
      };

      const storage: TemporaryFileStoragePort = {
        save: async () => ({ token: 'unused', sessionId: 'sess-1', fieldKey: 'identidad', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
        remove: async () => { order.push('removeTemporaryFile'); },
        cleanup: async () => 0,
      };

      const drive: GoogleDriveRepositoryPort = {
        storeSubmissionFiles: async () => {
          order.push('drive:storeFiles');
          return {
            files: [
              { token: 'tok_id', driveFileId: 'drive-1' },
              { token: 'tok_cv', driveFileId: 'drive-2' },
              { token: 'tok_tit', driveFileId: 'drive-3' },
              { token: 'tok_mot', driveFileId: 'drive-4' },
            ],
            documentsFolderId: 'folder-target-123',
            documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-target-123',
          };
        },
      };

      const spreadsheetRepo = {
        readHeaders: async () => [],
        appendByHeaders: async () => {
          order.push('sheets:append');
          return {
            spreadsheetId: 'sheet-abc',
            sheetName: 'Inscripciones',
            sheetId: 12345,
            updatedRange: 'Inscripciones!A15:Z15',
            rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=12345&range=A15:Z15',
            updatedRows: 1,
          };
        },
        diagnose: async () => ({ spreadsheetId: 'sheet-abc', accessible: true, sheetFound: true, headerDiagnostic: { valid: true, foundColumns: [], missingColumns: [], extraColumns: [] } }),
      };

      const notifRepo = new InMemoryEmailNotificationRepository();
      const originalEnsure = notifRepo.ensureForSubmission.bind(notifRepo);
      notifRepo.ensureForSubmission = async (input) => {
        order.push('notifications:ensure');
        return originalEnsure(input);
      };

      const app = createApp({
        catalog,
        repository: testRepo,
        formProfileRepository: profileRepo,
        temporaryFileStorage: storage,
        googleDriveRepository: drive,
        spreadsheetRepository: spreadsheetRepo,
        targetSpreadsheetService: {
          ensureForTarget: async () => ({ spreadsheetId: 'sheet-abc', sheetName: 'Inscripciones' }),
        } as any,
        emailNotificationRepository: notifRepo,
        getMasterEmails: async () => ['master@flacso.edu.uy'],
      });

      const tempServer = app.listen(0);
      const port = (tempServer.address() as { port: number }).port;
      try {
        const res = await fetch(`http://localhost:${port}/api/targets/davia-c11/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-preinscription-session': 'sess-1',
          },
          body: JSON.stringify(validPayload),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.submissionId).toBeDefined();

        expect(order).toEqual([
          'saveOrGet',
          'drive:storeFiles',
          'sheets:append',
          'markProcessing:success',
          'notifications:ensure',
          'removeTemporaryFile',
          'removeTemporaryFile',
          'removeTemporaryFile',
          'removeTemporaryFile',
        ]);

        const enqueued = await notifRepo.listNotifications({ submissionId: data.submissionId });
        expect(enqueued.length).toBeGreaterThanOrEqual(2); // applicant + target and/or master
        expect(enqueued.some((n) => n.audience === 'applicant')).toBe(true);
        expect(enqueued[0]?.payload.spreadsheetRowUrl).toBe(
          'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=12345&range=A15:Z15'
        );
        expect(enqueued[0]?.payload.documentsFolderUrl).toBe(
          'https://drive.google.com/drive/folders/folder-target-123'
        );
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });

    it('does not enqueue notifications when Drive fails', async () => {
      const catalog = new FixtureAcademicCatalog();
      const profileRepo = new MemoryFormProfileRepository();
      const testRepo = new InMemorySubmissionRepository();
      const notifRepo = new InMemoryEmailNotificationRepository();
      const ensureSpy = vi.spyOn(notifRepo, 'ensureForSubmission');

      const storage: TemporaryFileStoragePort = {
        save: async () => ({ token: 'unused', sessionId: 'sess-1', fieldKey: 'identidad', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
        remove: async () => undefined,
        cleanup: async () => 0,
      };

      const drive: GoogleDriveRepositoryPort = {
        storeSubmissionFiles: async () => { throw new Error('Drive error'); },
      };

      const app = createApp({
        catalog,
        repository: testRepo,
        formProfileRepository: profileRepo,
        temporaryFileStorage: storage,
        googleDriveRepository: drive,
        emailNotificationRepository: notifRepo,
      });

      const tempServer = app.listen(0);
      const port = (tempServer.address() as { port: number }).port;
      try {
        const res = await fetch(`http://localhost:${port}/api/targets/davia-c11/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-preinscription-session': 'sess-1',
          },
          body: JSON.stringify(validPayload),
        });

        expect(res.status).toBe(502);
        expect(ensureSpy).not.toHaveBeenCalled();
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });

    it('does not enqueue notifications when Sheets fails', async () => {
      const catalog = new FixtureAcademicCatalog();
      const profileRepo = new MemoryFormProfileRepository();
      const testRepo = new InMemorySubmissionRepository();
      const notifRepo = new InMemoryEmailNotificationRepository();
      const ensureSpy = vi.spyOn(notifRepo, 'ensureForSubmission');

      const storage: TemporaryFileStoragePort = {
        save: async () => ({ token: 'unused', sessionId: 'sess-1', fieldKey: 'identidad', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
        remove: async () => undefined,
        cleanup: async () => 0,
      };

      const drive: GoogleDriveRepositoryPort = {
        storeSubmissionFiles: async () => ({
          files: [],
          documentsFolderId: 'f1',
          documentsFolderUrl: 'https://drive.google.com/drive/folders/f1',
        }),
      };

      const app = createApp({
        catalog,
        repository: testRepo,
        formProfileRepository: profileRepo,
        temporaryFileStorage: storage,
        googleDriveRepository: drive,
        spreadsheetRepository: {
          readHeaders: async () => [],
          appendByHeaders: async () => { throw new Error('Sheets connection timeout'); },
          diagnose: async () => ({ spreadsheetId: 'sheet-1', accessible: false, sheetFound: false, headerDiagnostic: { valid: false, foundColumns: [], missingColumns: [], extraColumns: [] } }),
        },
        targetSpreadsheetService: {
          ensureForTarget: async () => ({ spreadsheetId: 'sheet-1', sheetName: 'Inscripciones' }),
        } as any,
        emailNotificationRepository: notifRepo,
      });

      const tempServer = app.listen(0);
      const port = (tempServer.address() as { port: number }).port;
      try {
        const res = await fetch(`http://localhost:${port}/api/targets/davia-c11/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-preinscription-session': 'sess-1',
          },
          body: JSON.stringify(validPayload),
        });

        expect(res.status).toBe(502);
        expect(ensureSpy).not.toHaveBeenCalled();
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });

    it('does not block or fail HTTP 201 response if outbox enqueuing throws an unexpected error', async () => {
      const catalog = new FixtureAcademicCatalog();
      const profileRepo = new MemoryFormProfileRepository();
      const testRepo = new InMemorySubmissionRepository();
      const notifRepo = new InMemoryEmailNotificationRepository();
      notifRepo.ensureForSubmission = async () => {
        throw new Error('Database disk full on outbox table');
      };

      const storage: TemporaryFileStoragePort = {
        save: async () => ({ token: 'unused', sessionId: 'sess-1', fieldKey: 'identidad', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
        remove: async () => undefined,
        cleanup: async () => 0,
      };

      const drive: GoogleDriveRepositoryPort = {
        storeSubmissionFiles: async () => ({
          files: [],
          documentsFolderId: 'f1',
          documentsFolderUrl: 'https://drive.google.com/drive/folders/f1',
        }),
      };

      const app = createApp({
        catalog,
        repository: testRepo,
        formProfileRepository: profileRepo,
        temporaryFileStorage: storage,
        googleDriveRepository: drive,
        emailNotificationRepository: notifRepo,
      });

      const tempServer = app.listen(0);
      const port = (tempServer.address() as { port: number }).port;
      try {
        const res = await fetch(`http://localhost:${port}/api/targets/davia-c11/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-preinscription-session': 'sess-1',
          },
          body: JSON.stringify(validPayload),
        });

        // Fail-safe: Outbox failure does NOT block user from successfully submitting
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.submissionId).toBeDefined();
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });
  });
});
