import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { MemoryAdminSessionStore } from '../../application/admin-session.js';
import { MemorySystemSettingsRepository } from '../../infrastructure/fixtures/memory-system-settings-repository.js';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';
import { MemoryTargetSpreadsheetRepository } from '../../infrastructure/fixtures/memory-target-spreadsheet-repository.js';
import { TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';
import { EncryptedSettingsService } from '../../infrastructure/security/encrypted-settings.js';
import { InMemoryEmailNotificationRepository } from '../../infrastructure/database/in-memory-email-notification-repository.js';
import { EmailNotificationDispatcher } from '../../application/email-notification-dispatcher.js';
import type { SubmissionNotificationSnapshot } from '../../application/notification-snapshot.js';

describe('Admin Settings Routes (/api/admin/settings)', () => {
  let server: Server;
  let baseUrl: string;
  let sessionStore: MemoryAdminSessionStore;
  let settingsRepository: MemorySystemSettingsRepository;
  let encryptedSettingsService: EncryptedSettingsService;
  let emailNotificationRepository: InMemoryEmailNotificationRepository;
  let mockEmailProvider: { send: any };
  let dispatcher: EmailNotificationDispatcher;
  let validCookie: string;
  let csrfToken: string;

  const testMasterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const mockVerifier: GoogleIdentityVerifierPort = {
    verify: async () => ({
      sub: 'google-sub-1',
      email: 'web@flacso.edu.uy',
      emailVerified: true,
      name: 'Web Admin',
    }),
    generateAuthUrl: () => 'https://mock.google.auth.url',
  };

  beforeAll(async () => {
    sessionStore = new MemoryAdminSessionStore();
    settingsRepository = new MemorySystemSettingsRepository({
      google_drive_folder_id: '1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e',
    });
    encryptedSettingsService = new EncryptedSettingsService(settingsRepository, testMasterKey);
    emailNotificationRepository = new InMemoryEmailNotificationRepository();
    mockEmailProvider = {
      send: vi.fn(async () => ({ providerMessageId: 'mock-ses-test-msg-id-123' })),
    };
    dispatcher = new EmailNotificationDispatcher({
      repository: emailNotificationRepository,
      provider: mockEmailProvider,
    });

    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      adminSessionStore: sessionStore,
      googleIdentityVerifier: mockVerifier,
      systemSettingsRepository: settingsRepository,
      encryptedSettingsService,
      emailNotificationRepository,
      emailNotificationDispatcher: dispatcher,
      emailProviderFactory: () => mockEmailProvider,
      serviceAccountEmail: 'preinscripciones@flacso-uruguay.iam.gserviceaccount.com',
      googleDriveRepository: {
        storeSubmissionFiles: async () => ({ files: [], documentsFolderId: 'folder-1', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1' }),
        inspectFolder: async (folderId) => ({ id: folderId, name: 'Preinscripciones FLACSO', canAddChildren: true }),
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

    // Create a valid session
    const session = await sessionStore.createSession({
      id: 'admin_1',
      googleSubject: 'google-sub-1',
      email: 'web@flacso.edu.uy',
      name: 'Web Admin',
      role: 'admin',
      createdAt: new Date(),
    });

    validCookie = `flacso_admin_session=${session.id}`;
    csrfToken = session.csrfToken;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects GET /api/admin/settings without session (401)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings`);
    expect(res.status).toBe(401);
  });

  it('returns current settings when authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings`, {
      headers: { Cookie: validCookie },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.googleDriveFolderId).toBe('1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e');
    expect(body.googleDriveFolderName).toBe('Preinscripciones FLACSO');
    expect(body.googleDriveCanAddChildren).toBe(true);
    expect(body.serviceAccountEmail).toBe('preinscripciones@flacso-uruguay.iam.gserviceaccount.com');
  });

  it('returns no Drive root until it is configured from the admin UI', async () => {
    const emptySettings = new MemorySystemSettingsRepository();
    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      adminSessionStore: sessionStore,
      googleIdentityVerifier: mockVerifier,
      systemSettingsRepository: emptySettings,
      serviceAccountEmail: 'preinscripciones@flacso-uruguay.iam.gserviceaccount.com',
    });
    const temporaryServer = app.listen(0);
    await new Promise<void>((resolve) => temporaryServer.once('listening', () => resolve()));
    const address = temporaryServer.address();
    const url = `http://localhost:${(address as { port: number }).port}/api/admin/settings`;

    const res = await fetch(url, { headers: { Cookie: validCookie } });

    expect(res.status).toBe(200);
    expect((await res.json()).googleDriveFolderId).toBeNull();
    await new Promise<void>((resolve) => temporaryServer.close(() => resolve()));
  });

  it('rejects PUT /api/admin/settings/google-drive without CSRF token (403)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/google-drive`, {
      method: 'PUT',
      headers: {
        Cookie: validCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folderId: 'new_folder_1234567890' }),
    });

    expect(res.status).toBe(403);
  });

  it('updates folder ID with valid ID and CSRF token', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/google-drive`, {
      method: 'PUT',
      headers: {
        Cookie: validCookie,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folderId: '1abcDEFghiJKLmnoPQRstuVWXyz_12345' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.googleDriveFolderId).toBe('1abcDEFghiJKLmnoPQRstuVWXyz_12345');

    const updated = await settingsRepository.getSetting('google_drive_folder_id');
    expect(updated).toBe('1abcDEFghiJKLmnoPQRstuVWXyz_12345');
  });

  it('extracts folder ID when full Google Drive URL is provided', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/google-drive`, {
      method: 'PUT',
      headers: {
        Cookie: validCookie,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderId: 'https://drive.google.com/drive/u/3/folders/1customFolderIdFromFullUrl123?usp=sharing',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.googleDriveFolderId).toBe('1customFolderIdFromFullUrl123');

    const updated = await settingsRepository.getSetting('google_drive_folder_id');
    expect(updated).toBe('1customFolderIdFromFullUrl123');
  });

  it('does not save a folder that the service account cannot write to', async () => {
    const readOnlySettings = new MemorySystemSettingsRepository();
    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      adminSessionStore: sessionStore,
      googleIdentityVerifier: mockVerifier,
      systemSettingsRepository: readOnlySettings,
      googleDriveRepository: {
        storeSubmissionFiles: async () => ({ files: [], documentsFolderId: 'folder-1', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1' }),
        inspectFolder: async (folderId) => ({ id: folderId, name: 'Solo lectura', canAddChildren: false }),
      },
    });
    const temporaryServer = app.listen(0);
    await new Promise<void>((resolve) => temporaryServer.once('listening', () => resolve()));
    const address = temporaryServer.address();
    const url = `http://localhost:${(address as { port: number }).port}/api/admin/settings/google-drive`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: { Cookie: validCookie, 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: '1readOnlyFolder123456789' }),
    });

    expect(res.status).toBe(403);
    expect(await readOnlySettings.getSetting('google_drive_folder_id')).toBeNull();
    await new Promise<void>((resolve) => temporaryServer.close(() => resolve()));
  });

  it('rejects invalid folder ID formats', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/google-drive`, {
      method: 'PUT',
      headers: {
        Cookie: validCookie,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folderId: 'short' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_FOLDER_ID');
  });

  it('creates missing spreadsheets automatically for every catalog target', async () => {
    const targetSpreadsheetRepository = new MemoryTargetSpreadsheetRepository();
    const targetSpreadsheetService = new TargetSpreadsheetService(
      targetSpreadsheetRepository,
      {
        create: vi.fn(async ({ title, sheetName }) => ({
          spreadsheetId: `sheet-${title.slice(0, 8)}`,
          sheetName,
          url: 'https://docs.google.com/spreadsheets/d/generated/edit',
        })),
      },
      async () => 'drive-root-1',
    );
    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      adminSessionStore: sessionStore,
      googleIdentityVerifier: mockVerifier,
      systemSettingsRepository: new MemorySystemSettingsRepository(),
      targetSpreadsheetService,
      targetSpreadsheetRepository,
    });
    const temporaryServer = app.listen(0);
    await new Promise<void>((resolve) => temporaryServer.once('listening', () => resolve()));
    const address = temporaryServer.address();
    const res = await fetch(`http://localhost:${(address as { port: number }).port}/api/admin/settings/spreadsheets/provision`, {
      method: 'POST',
      headers: { Cookie: validCookie, 'x-csrf-token': csrfToken },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.spreadsheets).toHaveLength(5);
    expect(await targetSpreadsheetRepository.list()).toHaveLength(5);
    await new Promise<void>((resolve) => temporaryServer.close(() => resolve()));
  });

  it('PUT /google-drive initiates reconciliation and reports completed status per target', async () => {
    const targetSpreadsheetRepository = new MemoryTargetSpreadsheetRepository();
    const targetSpreadsheetService = new TargetSpreadsheetService(
      targetSpreadsheetRepository,
      {
        create: vi.fn(async ({ title, sheetName }) => ({
          spreadsheetId: `sheet-${title.slice(0, 8)}`,
          sheetName,
          url: 'https://docs.google.com/spreadsheets/d/generated/edit',
        })),
      },
      async () => 'new-root-folder-12345',
    );
    const customSettings = new MemorySystemSettingsRepository();
    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      adminSessionStore: sessionStore,
      googleIdentityVerifier: mockVerifier,
      systemSettingsRepository: customSettings,
      googleDriveRepository: {
        storeSubmissionFiles: async () => ({ files: [], documentsFolderId: 'folder-1', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1' }),
        inspectFolder: async (folderId) => ({ id: folderId, name: 'Carpeta Nueva', canAddChildren: true }),
      },
      targetSpreadsheetService,
      targetSpreadsheetRepository,
    });
    const temporaryServer = app.listen(0);
    await new Promise<void>((resolve) => temporaryServer.once('listening', () => resolve()));
    const address = temporaryServer.address();

    const res = await fetch(`http://localhost:${(address as { port: number }).port}/api/admin/settings/google-drive`, {
      method: 'PUT',
      headers: {
        Cookie: validCookie,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folderId: 'new-root-folder-12345' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.googleDriveFolderId).toBe('new-root-folder-12345');
    expect(body.reconciliation).toBeDefined();
    expect(body.reconciliation.status).toBe('completed');
    expect(body.reconciliation.targets.length).toBeGreaterThan(0);
    expect(body.reconciliation.targets.every((t: any) => t.status === 'created' || t.status === 'reconciled')).toBe(true);

    await new Promise<void>((resolve) => temporaryServer.close(() => resolve()));
  });

  it('PUT /google-drive reports ok: false and status: blocked when any target encounters a permission error during reconciliation', async () => {
    const targetSpreadsheetRepository = new MemoryTargetSpreadsheetRepository();
    const mockDiscoveryPort = {
      findByTargetId: vi.fn().mockResolvedValue({
        targetId: 'diploma-educacion-imagenes',
        spreadsheetId: 'sheet-perm-locked',
        sheetName: 'Inscripciones',
        parentFolderId: 'old-parent',
        url: 'https://docs.google.com/spreadsheets/d/sheet-perm-locked/edit',
      }),
      ensureTargetFolder: vi.fn().mockResolvedValue('target-folder'),
      moveSpreadsheet: vi.fn().mockRejectedValue(new Error('Permission denied on Drive move')),
    };
    const targetSpreadsheetService = new TargetSpreadsheetService(
      targetSpreadsheetRepository,
      { create: vi.fn() },
      async () => 'new-root-folder-perm',
      mockDiscoveryPort as any,
    );
    const customSettings = new MemorySystemSettingsRepository();
    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      adminSessionStore: sessionStore,
      googleIdentityVerifier: mockVerifier,
      systemSettingsRepository: customSettings,
      googleDriveRepository: {
        storeSubmissionFiles: async () => ({ files: [], documentsFolderId: 'folder-1', documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1' }),
        inspectFolder: async (folderId) => ({ id: folderId, name: 'Carpeta Nueva', canAddChildren: true }),
      },
      targetSpreadsheetService,
      targetSpreadsheetRepository,
    });
    const temporaryServer = app.listen(0);
    await new Promise<void>((resolve) => temporaryServer.once('listening', () => resolve()));
    const address = temporaryServer.address();

    const res = await fetch(`http://localhost:${(address as { port: number }).port}/api/admin/settings/google-drive`, {
      method: 'PUT',
      headers: {
        Cookie: validCookie,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folderId: 'new-root-folder-perm' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // ok must be false because at least one target is blocked
    expect(body.ok).toBe(false);
    expect(body.googleDriveFolderId).toBe('new-root-folder-perm');
    expect(body.reconciliation).toBeDefined();
    expect(body.reconciliation.status).toBe('blocked');
    const blockedTarget = body.reconciliation.targets.find((t: any) => t.status === 'blocked');
    expect(blockedTarget).toBeDefined();
    expect(blockedTarget.message).toContain('Permission denied on Drive move');

    // Folder setting should still be saved so user can re-try
    expect(await customSettings.getSetting('google_drive_folder_id')).toBe('new-root-folder-perm');

    await new Promise<void>((resolve) => temporaryServer.close(() => resolve()));
  });

  describe('Email & SES Settings (/api/admin/settings/email)', () => {
    it('GET /email rejects unauthenticated requests with 401', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/email`);
      expect(res.status).toBe(401);
    });

    it('GET /email returns default unconfigured state when nothing has been configured', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/email`, {
        headers: { Cookie: validCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(false);
      expect(body.ses.configured).toBe(false);
      expect(body.ses.region).toBeNull();
      expect(body.ses.fromEmail).toBeNull();
      expect(body.masterEmails).toEqual([]);
    });

    it('PUT /email rejects invalid master emails format with 400', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/email`, {
        method: 'PUT',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          masterEmails: ['valid@flacso.edu.uy', 'invalid-email-address'],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('PUT /email saves SES configuration and master emails encrypted, never exposes plaintext secrets', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/email`, {
        method: 'PUT',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          ses: {
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            region: 'us-east-1',
            fromEmail: 'preinscripciones@flacso.edu.uy',
            replyToEmail: 'consultas@flacso.edu.uy',
            configurationSet: 'flacso-notifications-config',
          },
          masterEmails: ['coordinacion@flacso.edu.uy', 'soporte@flacso.edu.uy'],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(true);
      expect(body.ses.configured).toBe(true);
      expect(body.ses.region).toBe('us-east-1');
      expect(body.ses.fromEmail).toBe('pr***s@flacso.edu.uy');
      expect(body.ses.replyToEmail).toBe('co***s@flacso.edu.uy');
      expect(body.ses.hasAccessKey).toBe(true);
      expect(body.ses.hasSecretKey).toBe(true);
      expect(body.masterEmails).toEqual(['coordinacion@flacso.edu.uy', 'soporte@flacso.edu.uy']);

      // CRITICAL: Plaintext secrets MUST NEVER appear in API response
      expect(JSON.stringify(body)).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');

      // CRITICAL: Plaintext secrets MUST NEVER appear in raw repository
      const rawSecret = await settingsRepository.getSetting('ses_aws_secret_access_key');
      expect(rawSecret).not.toBeNull();
      expect(rawSecret).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      expect(rawSecret!.startsWith('enc:v1:')).toBe(true);
    });

    it('GET /email returns masked credentials after configuration without plaintext secrets', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/email`, {
        headers: { Cookie: validCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.enabled).toBe(true);
      expect(body.ses.configured).toBe(true);
      expect(body.ses.fromEmail).toBe('pr***s@flacso.edu.uy');
      expect(body.ses.region).toBe('us-east-1');
      expect(body.masterEmails).toEqual(['coordinacion@flacso.edu.uy', 'soporte@flacso.edu.uy']);
      expect(JSON.stringify(body)).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });

    it('POST /email/test rejects unauthenticated request (401)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/email/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail: 'test@flacso.edu.uy' }),
      });
      expect(res.status).toBe(401);
    });

    it('POST /email/test rejects invalid or empty recipient (400)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/email/test`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipientEmail: 'not-an-email' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /email/test sends test email when SES is configured (200)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/email/test`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipientEmail: 'admin-test@flacso.edu.uy' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.providerMessageId).toBe('mock-ses-test-msg-id-123');
      expect(mockEmailProvider.send).toHaveBeenCalled();
    });

    function makeSnapshot(submissionId: string, email: string): SubmissionNotificationSnapshot {
      return {
        submissionId,
        targetId: 'diploma-dgd',
        targetTitle: 'Diploma en Gestión Digital',
        targetKind: 'academic_offer',
        applicantEmail: email,
        applicantName: 'Test User',
        values: {
          email: { key: 'email', label: 'Email', value: email },
        },
        orderedFieldKeys: ['email'],
        spreadsheetRowUrl: 'https://docs.google.com/spreadsheets/d/123/edit#gid=0&range=2:2',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/123',
        templateVersion: 'preinscription-notification-v1',
      };
    }

    it('GET /notifications rejects unauthenticated request (401)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/notifications`);
      expect(res.status).toBe(401);
    });

    it('GET /notifications returns counts and list of notifications', async () => {
      const snapshot = makeSnapshot('sub-test-10', 'juan@example.com');

      await emailNotificationRepository.ensureForSubmission({
        submissionId: 'sub-test-10',
        snapshot,
        recipients: [
          { audience: 'applicant', email: 'juan@example.com' },
          { audience: 'target', email: 'coordinacion-dgd@flacso.edu.uy' },
        ],
      });

      const res = await fetch(`${baseUrl}/api/admin/settings/notifications`, {
        headers: { Cookie: validCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.counts.pending).toBeGreaterThanOrEqual(2);
      expect(body.notifications.length).toBeGreaterThanOrEqual(2);
      expect(body.notifications[0]).toHaveProperty('id');
      expect(body.notifications[0]).toHaveProperty('status');
      expect(body.notifications[0]).toHaveProperty('recipientEmail');
    });

    it('POST /notifications/:id/retry rejects unauthenticated request (401)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/notifications/some-id/retry`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('POST /notifications/:id/retry returns 404 for unknown notification', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/notifications/non-existent-id/retry`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
        },
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('POST /notifications/:id/retry rejects retry for sent notification (400)', async () => {
      const snapshot = makeSnapshot('sub-sent-1', 'sent@example.com');

      const [record] = await emailNotificationRepository.ensureForSubmission({
        submissionId: 'sub-sent-1',
        snapshot,
        recipients: [{ audience: 'applicant', email: 'sent@example.com' }],
      });
      if (!record) throw new Error('Record not found');

      await emailNotificationRepository.markSent(record.id, 'msg-123', new Date());

      const res = await fetch(`${baseUrl}/api/admin/settings/notifications/${record.id}/retry`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_STATUS');
    });

    it('POST /notifications/:id/retry requires force: true for unknown status', async () => {
      const snapshot = makeSnapshot('sub-unknown-1', 'unknown@example.com');

      const [record] = await emailNotificationRepository.ensureForSubmission({
        submissionId: 'sub-unknown-1',
        snapshot,
        recipients: [{ audience: 'applicant', email: 'unknown@example.com' }],
      });
      if (!record) throw new Error('Record not found');

      await emailNotificationRepository.markUnknown(record.id, 'Connection reset by peer');

      // Without force: should fail
      const resWithoutForce = await fetch(`${baseUrl}/api/admin/settings/notifications/${record.id}/retry`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
        },
      });
      expect(resWithoutForce.status).toBe(400);
      const bodyWithoutForce = await resWithoutForce.json();
      expect(bodyWithoutForce.error.code).toBe('UNKNOWN_STATUS_REQUIRES_CONFIRMATION');

      // With force: true: should succeed
      const resWithForce = await fetch(`${baseUrl}/api/admin/settings/notifications/${record.id}/retry`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force: true }),
      });
      expect(resWithForce.status).toBe(200);
      const updated = await emailNotificationRepository.findById(record.id);
      expect(updated?.status).toBe('pending');
    });

    it('POST /notifications/:id/retry resets failed notification to pending', async () => {
      const snapshot = makeSnapshot('sub-failed-1', 'failed@example.com');

      const [record] = await emailNotificationRepository.ensureForSubmission({
        submissionId: 'sub-failed-1',
        snapshot,
        recipients: [{ audience: 'applicant', email: 'failed@example.com' }],
      });
      if (!record) throw new Error('Record not found');

      await emailNotificationRepository.markPermanentFailure(record.id, 'Mailbox does not exist', new Date());

      const res = await fetch(`${baseUrl}/api/admin/settings/notifications/${record.id}/retry`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
        },
      });
      expect(res.status).toBe(200);
      const updated = await emailNotificationRepository.findById(record.id);
      expect(updated?.status).toBe('pending');
    });

    it('POST /notifications/:id/retry resets failed notification with updated recipientEmail', async () => {
      const snapshot = makeSnapshot('sub-failed-update-email', 'wrong@example.com');

      const [record] = await emailNotificationRepository.ensureForSubmission({
        submissionId: 'sub-failed-update-email',
        snapshot,
        recipients: [{ audience: 'applicant', email: 'wrong@example.com' }],
      });
      if (!record) throw new Error('Record not found');

      await emailNotificationRepository.markPermanentFailure(record.id, 'Mailbox not found', new Date());

      const res = await fetch(`${baseUrl}/api/admin/settings/notifications/${record.id}/retry`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipientEmail: 'corrected@example.com' }),
      });
      expect(res.status).toBe(200);
      const updated = await emailNotificationRepository.findById(record.id);
      expect(updated?.status).toBe('pending');
      expect(updated?.recipientEmail).toBe('corrected@example.com');
    });

    it('POST /notifications/dispatch triggers manual batch dispatch', async () => {
      const res = await fetch(`${baseUrl}/api/admin/settings/notifications/dispatch`, {
        method: 'POST',
        headers: {
          Cookie: validCookie,
          'x-csrf-token': csrfToken,
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body).toHaveProperty('processed');
      expect(body).toHaveProperty('sent');
      expect(body).toHaveProperty('failed');
    });
  });
});
