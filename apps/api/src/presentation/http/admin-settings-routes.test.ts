import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { MemoryAdminSessionStore } from '../../application/admin-session.js';
import { MemorySystemSettingsRepository } from '../../infrastructure/fixtures/memory-system-settings-repository.js';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';

describe('Admin Settings Routes (/api/admin/settings)', () => {
  let server: Server;
  let baseUrl: string;
  let sessionStore: MemoryAdminSessionStore;
  let settingsRepository: MemorySystemSettingsRepository;
  let validCookie: string;
  let csrfToken: string;

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

    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      adminSessionStore: sessionStore,
      googleIdentityVerifier: mockVerifier,
      systemSettingsRepository: settingsRepository,
      serviceAccountEmail: 'preinscripciones@flacso-uruguay.iam.gserviceaccount.com',
      googleDriveRepository: {
        storeSubmissionFiles: async () => [],
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
        storeSubmissionFiles: async () => [],
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
});
