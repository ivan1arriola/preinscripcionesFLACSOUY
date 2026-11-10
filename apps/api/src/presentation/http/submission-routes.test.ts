import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { getTargetForm } from '../../application/get-target-form.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import { InMemoryEmailNotificationRepository } from '../../infrastructure/database/in-memory-email-notification-repository.js';
import { InMemorySubmissionRecoveryRepository } from '../../infrastructure/database/in-memory-submission-recovery-repository.js';
import { InMemoryTelegramAlertRepository } from '../../infrastructure/database/in-memory-telegram-alert-repository.js';

describe('Submission HTTP Routes', () => {
  let server: Server;
  let baseUrl: string;
  let repository: InMemorySubmissionRepository;
  let notificationRepository: InMemoryEmailNotificationRepository;
  const metaEvents: Array<Record<string, unknown>> = [];

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
      aceptaComunicaciones: 'Si',
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
    const formResult = await getTargetForm(catalog, 'davia-c11');
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
      temporaryFileStorage: storage,
      googleDriveRepository: drive,
      emailNotificationRepository: notificationRepository,
      metaTracker: {
        pixelId: '999',
        sendSubmitApplication: async (event) => {
          metaEvents.push({ ...event });
        },
      },
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
        Cookie: '_fbp=fb.1.1700000000.123; _fbc=fb.1.1700000000.abc',
        Referer: 'https://preinscripciones.flacso.edu.uy/diploma-en-genero',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.submissionId).toBeDefined();
    expect(data.submissionId).toMatch(/^sub_/);

    // SubmitApplication por CAPI con el mismo event_id que usará el navegador.
    expect(metaEvents).toHaveLength(1);
    expect(metaEvents[0]).toMatchObject({
      eventId: data.submissionId,
      fbp: 'fb.1.1700000000.123',
      fbc: 'fb.1.1700000000.abc',
      eventSourceUrl: 'https://preinscripciones.flacso.edu.uy/diploma-en-genero',
    });

    const queuedNotifications = await notificationRepository.listNotifications({ submissionId: data.submissionId });
    expect(queuedNotifications.length).toBeGreaterThan(0);
    const applicantNotif = queuedNotifications.find((n) => n.audience === 'applicant');
    expect(applicantNotif).toBeDefined();
    expect(applicantNotif?.recipientEmail).toBe('lucia@example.com');
    expect(applicantNotif?.payload.documentsFolderUrl).toBe('https://drive.google.com/drive/folders/folder-1');
  });

  it('rejects a submission that omits `files` instead of skipping the mandatory documents', async () => {
    const { files: _omitted, ...withoutFiles } = validPayload;
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-preinscription-session': 'session-test' },
      body: JSON.stringify(withoutFiles),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(data.error.fieldErrors)).toEqual(expect.arrayContaining(['identidad', 'cv']));
  });

  it('rejects the same file token attached twice', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-preinscription-session': 'session-test' },
      body: JSON.stringify({
        ...validPayload,
        files: validPayload.files.map((file) => ({ ...file, token: 'tok_shared' })),
      }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_REQUEST');
  });

  it('returns the original submission for a repeated clientSubmissionId without repeating side effects', async () => {
    const send = () => fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-preinscription-session': 'session-test' },
      body: JSON.stringify({ ...validPayload, clientSubmissionId: 'client-idempotent-1' }),
    });

    const first = await send();
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const notificationsAfterFirst = (await notificationRepository.listNotifications({ submissionId: firstBody.submissionId })).length;

    const second = await send();
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toEqual({ submissionId: firstBody.submissionId, existing: true });

    const notificationsAfterSecond = (await notificationRepository.listNotifications({ submissionId: firstBody.submissionId })).length;
    expect(notificationsAfterSecond).toBe(notificationsAfterFirst);
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
          'https://docs.google.com/spreadsheets/d/sheet-abc/edit'
        );
        expect(enqueued[0]?.payload.documentsFolderUrl).toBe(
          'https://drive.google.com/drive/folders/folder-target-123'
        );
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });

    it('records a recoverable notification failure after the submission is stored', async () => {
      const catalog = new FixtureAcademicCatalog();
      const testRepo = new InMemorySubmissionRepository();
      const notifRepo = new InMemoryEmailNotificationRepository();
      const recoveryRepo = new InMemorySubmissionRecoveryRepository();
      vi.spyOn(notifRepo, 'ensureForSubmission').mockRejectedValue(new Error('database unavailable'));
      const storage: TemporaryFileStoragePort = {
        save: async () => ({ token: 'unused', sessionId: 'sess-1', fieldKey: 'identidad', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
        remove: async () => undefined, cleanup: async () => 0,
      };
      const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async ({ files }) => ({ files: files.map((f) => ({ token: f.token, driveFileId: `drive-${f.token}` })), documentsFolderId: 'folder-1', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1' }) };
      const app = createApp({ catalog, repository: testRepo, temporaryFileStorage: storage, googleDriveRepository: drive,
        emailNotificationRepository: notifRepo, submissionRecoveryRepository: recoveryRepo });
      const tempServer = app.listen(0);
      const port = (tempServer.address() as { port: number }).port;
      try {
        const res = await fetch(`http://localhost:${port}/api/targets/davia-c11/submissions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-preinscription-session': 'sess-1' }, body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        const recovery = await recoveryRepo.findById(data.submissionId);
        expect(recovery?.stage).toBe('notifications');
        expect(recovery?.status).toBe('pending');
      } finally { await new Promise<void>((resolve) => tempServer.close(() => resolve())); }
    });

    it('leaves no pending recovery when notifications are enqueued', async () => {
      const catalog = new FixtureAcademicCatalog();
      const notifRepo = new InMemoryEmailNotificationRepository();
      const recoveryRepo = new InMemorySubmissionRecoveryRepository();
      for (const t of (catalog as unknown as { targets: Array<{ notificationEmails?: string[] }> }).targets) t.notificationEmails = ['coordinacion@example.org'];
      const storage: TemporaryFileStoragePort = { save: async () => ({ token: 'unused', sessionId: 's', fieldKey: 'x', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }), remove: async () => undefined, cleanup: async () => 0 };
      const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async ({ files }) => ({ files: files.map((f) => ({ token: f.token, driveFileId: `drive-${f.token}` })), documentsFolderId: 'folder', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder' }) };
      const app = createApp({ catalog, repository: new InMemorySubmissionRepository(), temporaryFileStorage: storage, googleDriveRepository: drive, emailNotificationRepository: notifRepo, submissionRecoveryRepository: recoveryRepo });
      const server = app.listen(0); const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://localhost:${port}/api/targets/davia-c11/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-preinscription-session': 's' }, body: JSON.stringify(validPayload) });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect((await recoveryRepo.findById(data.submissionId))?.status).toBe('resolved');
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    });

    it('keeps the reserved recovery pending when the failure cannot be recorded afterwards', async () => {
      const catalog = new FixtureAcademicCatalog();
      const notifRepo = new InMemoryEmailNotificationRepository();
      const recoveryRepo = new InMemorySubmissionRecoveryRepository();
      vi.spyOn(notifRepo, 'ensureForSubmission').mockRejectedValue(new Error('database unavailable'));
      const realRecord = recoveryRepo.recordFailure.bind(recoveryRepo);
      let calls = 0;
      vi.spyOn(recoveryRepo, 'recordFailure').mockImplementation(async (input) => {
        if (++calls > 1) throw new Error('database unavailable');
        return realRecord(input);
      });
      const storage: TemporaryFileStoragePort = { save: async () => ({ token: 'unused', sessionId: 's', fieldKey: 'x', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }), remove: async () => undefined, cleanup: async () => 0 };
      const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async ({ files }) => ({ files: files.map((f) => ({ token: f.token, driveFileId: `drive-${f.token}` })), documentsFolderId: 'folder', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder' }) };
      const app = createApp({ catalog, repository: new InMemorySubmissionRepository(), temporaryFileStorage: storage, googleDriveRepository: drive, emailNotificationRepository: notifRepo, submissionRecoveryRepository: recoveryRepo });
      const server = app.listen(0); const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://localhost:${port}/api/targets/davia-c11/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-preinscription-session': 's' }, body: JSON.stringify(validPayload) });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect((await recoveryRepo.findById(data.submissionId))?.status).toBe('pending');
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    });

    it('records a notification issue when the authenticated target has no coordination email', async () => {
      const catalog = new FixtureAcademicCatalog();
      for (const t of (catalog as unknown as { targets: Array<{ notificationEmails?: string[] }> }).targets) t.notificationEmails = [];
      const storage: TemporaryFileStoragePort = { save: async () => ({ token: 'unused', sessionId: 's', fieldKey: 'x', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }), remove: async () => undefined, cleanup: async () => 0 };
      const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async ({ files }) => ({ files: files.map((f) => ({ token: f.token, driveFileId: `drive-${f.token}` })), documentsFolderId: 'folder', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder' }) };
      const recoveryRepo = new InMemorySubmissionRecoveryRepository();
      const notifRepo = new InMemoryEmailNotificationRepository();
      const app = createApp({ catalog, repository: new InMemorySubmissionRepository(), temporaryFileStorage: storage, googleDriveRepository: drive, emailNotificationRepository: notifRepo, submissionRecoveryRepository: recoveryRepo });
      const server = app.listen(0); const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://localhost:${port}/api/targets/davia-c11/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-preinscription-session': 's' }, body: JSON.stringify(validPayload) });
        expect(res.status).toBe(201);
        const data = await res.json();
        const recovery = await recoveryRepo.findById(data.submissionId);
        expect(recovery?.stage).toBe('notifications');
        expect(recovery?.safeError).toContain('correos de coordinación');
        expect((await notifRepo.listNotifications({ submissionId: data.submissionId })).some(n => n.audience === 'applicant')).toBe(true);
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    });

    it('captures Drive failure, returns tracking ID, creates recovery case and does not enqueue notifications', async () => {
      const catalog = new FixtureAcademicCatalog();
      const testRepo = new InMemorySubmissionRepository();
      const notifRepo = new InMemoryEmailNotificationRepository();
      const recoveryRepo = new InMemorySubmissionRecoveryRepository();
      const ensureSpy = vi.spyOn(notifRepo, 'ensureForSubmission');

      const storage: TemporaryFileStoragePort = {
        save: async () => ({ token: 'unused', sessionId: 'sess-1', fieldKey: 'identidad', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
        open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
        remove: async () => undefined,
        cleanup: async () => 0,
      };

      const drive: GoogleDriveRepositoryPort = {
        storeSubmissionFiles: async () => { throw new Error('Drive error: internal timeout'); },
      };

      const app = createApp({
        catalog,
        repository: testRepo,
        temporaryFileStorage: storage,
        googleDriveRepository: drive,
        emailNotificationRepository: notifRepo,
        submissionRecoveryRepository: recoveryRepo,
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

        expect(res.status).toBe(202);
        const data = await res.json();
        expect(data.submissionId).toBeDefined();
        expect(data.submissionId).toMatch(/^sub_/);
        expect(data.status).toBe('pending_processing');
        expect(ensureSpy).not.toHaveBeenCalled();

        // Values are retained in submission repository
        const savedSub = testRepo.submissions.find((s) => s.id === data.submissionId);
        expect(savedSub).toBeDefined();
        expect(savedSub?.values.email).toBe('lucia@example.com');

        // Recovery record is created with stage 'drive'
        const recovery = await recoveryRepo.findById(data.submissionId);
        expect(recovery).not.toBeNull();
        expect(recovery?.stage).toBe('drive');
        expect(recovery?.status).toBe('pending');
        expect(recovery?.attemptCount).toBe(1);
        expect(recovery?.safeError).toContain('Drive error');
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });

    it('captures Sheets failure, returns tracking ID, creates recovery case and does not enqueue notifications', async () => {
      const catalog = new FixtureAcademicCatalog();
      const testRepo = new InMemorySubmissionRepository();
      const notifRepo = new InMemoryEmailNotificationRepository();
      const recoveryRepo = new InMemorySubmissionRecoveryRepository();
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
        submissionRecoveryRepository: recoveryRepo,
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

        expect(res.status).toBe(202);
        const data = await res.json();
        expect(data.submissionId).toBeDefined();
        expect(data.submissionId).toMatch(/^sub_/);
        expect(data.status).toBe('pending_processing');
        expect(ensureSpy).not.toHaveBeenCalled();

        // Recovery record is created with stage 'sheets'
        const recovery = await recoveryRepo.findById(data.submissionId);
        expect(recovery).not.toBeNull();
        expect(recovery?.stage).toBe('sheets');
        expect(recovery?.status).toBe('pending');
        expect(recovery?.safeError).toContain('Sheets connection timeout');
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });

    it('does not block or fail HTTP 201 response if outbox enqueuing throws an unexpected error', async () => {
      const catalog = new FixtureAcademicCatalog();
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

    it('enqueues a Telegram alert on Sheets failure with safe metadata and no PII, leaving response and recovery intact when provider is unavailable', async () => {
      const catalog = new FixtureAcademicCatalog();
      const testRepo = new InMemorySubmissionRepository();
      const recoveryRepo = new InMemorySubmissionRecoveryRepository();
      const telegramAlertRepo = new InMemoryTelegramAlertRepository();

      const spreadsheetService = {
        ensureForTarget: vi.fn(async () => ({
          spreadsheetId: 'sheet-tgt-1',
          sheetName: 'Preinscripciones',
        })),
      };

      const failingSpreadsheetRepo = {
        appendByHeaders: vi.fn(async () => {
          throw new Error('Google Sheets API 503 Service Unavailable');
        }),
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
        temporaryFileStorage: storage,
        googleDriveRepository: drive,
        submissionRecoveryRepository: recoveryRepo,
        targetSpreadsheetService: spreadsheetService as any,
        spreadsheetRepository: failingSpreadsheetRepo as any,
        telegramAlertRepository: telegramAlertRepo,
        getTelegramChatIds: async () => ['-100123456789'],
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

        expect(res.status).toBe(202);
        const data = await res.json();
        expect(data.submissionId).toBeDefined();

        // Recovery record is preserved
        const recovery = await recoveryRepo.findById(data.submissionId);
        expect(recovery).not.toBeNull();
        expect(recovery?.stage).toBe('sheets');
        expect(recovery?.status).toBe('pending');

        // Telegram alert is enqueued
        const alerts = await telegramAlertRepo.listAlerts?.();
        expect(alerts).toBeDefined();
        expect(alerts).toHaveLength(1);
        const alert = alerts![0]!;
        expect(alert.submissionId).toBe(data.submissionId);
        expect(alert.chatId).toBe('-100123456789');
        expect(alert.status).toBe('pending');
        expect(alert.message).toContain('⚠️ Incidente de preinscripción FLACSO');
        expect(alert.message).toContain(data.submissionId);
        expect(alert.message).toContain('SHEETS');
        expect(alert.message).toContain('Google Sheets API 503');

        // Zero applicant PII in alert message
        expect(alert.message).not.toContain('Lucía');
        expect(alert.message).not.toContain('Méndez');
        expect(alert.message).not.toContain('lucia@example.com');
        expect(alert.message).not.toContain('34567894');
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });

    it('enqueues one Telegram preinscription alert per configured chat upon successful submission', async () => {
      const catalog = new FixtureAcademicCatalog();
      const testRepo = new InMemorySubmissionRepository();
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
      const telegramAlertRepo = new InMemoryTelegramAlertRepository();

      const app = createApp({
        catalog,
        repository: testRepo,
        temporaryFileStorage: storage,
        googleDriveRepository: drive,
        telegramAlertRepository: telegramAlertRepo,
        getTelegramPreinscriptionChatIds: async () => ['-100111111', '-100222222'],
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

        const alerts = await telegramAlertRepo.listAlerts({ eventType: 'preinscription' });
        expect(alerts).toHaveLength(2);
        expect(alerts.map((a) => a.chatId).sort()).toEqual(['-100111111', '-100222222'].sort());
        expect(alerts[0]!.message).toContain('✅ Nueva preinscripción recibida');
        expect(alerts[0]!.message).toContain(data.submissionId);
        expect(alerts[0]!.eventType).toBe('preinscription');
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });

    it('isolates Telegram failures so 201 is returned and submission remains successful even if telegram queue fails', async () => {
      const catalog = new FixtureAcademicCatalog();
      const testRepo = new InMemorySubmissionRepository();
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
      const failingTelegramAlertRepo = new InMemoryTelegramAlertRepository();
      vi.spyOn(failingTelegramAlertRepo, 'ensureForSubmission').mockRejectedValue(
        new Error('Database error in telegram queue')
      );

      const app = createApp({
        catalog,
        repository: testRepo,
        temporaryFileStorage: storage,
        googleDriveRepository: drive,
        telegramAlertRepository: failingTelegramAlertRepo,
        getTelegramPreinscriptionChatIds: async () => ['-100111111'],
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

        // Still returns 201 Created
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.submissionId).toBeDefined();

        // Submission in repo is successful
        const status = testRepo.processingStatuses.get(data.submissionId);
        expect(status?.status).toBe('success');
      } finally {
        await new Promise<void>((resolve) => tempServer.close(() => resolve()));
      }
    });
  });
});
