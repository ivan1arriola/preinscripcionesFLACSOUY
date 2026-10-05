import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { InMemorySubmissionRecoveryRepository } from '../../infrastructure/database/in-memory-submission-recovery-repository.js';
import { MemoryAdminSessionStore } from '../../application/admin-session.js';
import { MemorySystemSettingsRepository } from '../../infrastructure/fixtures/memory-system-settings-repository.js';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';

describe('Submission Recovery Routes (/api/admin/settings/recoveries)', () => {
  let server: Server;
  let baseUrl: string;
  let sessionStore: MemoryAdminSessionStore;
  let recoveryRepo: InMemorySubmissionRecoveryRepository;
  let submissionRepo: InMemorySubmissionRepository;
  let mockFileStorage: any;
  let mockSpreadsheetRepo: any;
  let mockTargetSpreadsheetService: any;
  let validCookie: string;
  let csrfToken: string;

  const mockVerifier: GoogleIdentityVerifierPort = {
    verify: async () => ({
      sub: 'google-sub-recovery',
      email: 'web@flacso.edu.uy',
      emailVerified: true,
      name: 'Web Admin',
    }),
    generateAuthUrl: () => 'https://mock.google.auth.url',
  };

  beforeAll(async () => {
    sessionStore = new MemoryAdminSessionStore();
    recoveryRepo = new InMemorySubmissionRecoveryRepository();
    submissionRepo = new InMemorySubmissionRepository();

    mockFileStorage = {
      open: vi.fn(async (token: string) => ({
        originalName: `${token}.pdf`,
        mimeType: 'application/pdf',
        data: Buffer.from('mock pdf'),
        createdAt: new Date(),
      })),
      remove: vi.fn(async () => undefined),
      cleanup: vi.fn(async () => 0),
    };

    mockSpreadsheetRepo = {
      appendByHeaders: vi.fn(async () => ({ rowUrl: 'https://sheets.google.com/recovered-row' })),
    };

    mockTargetSpreadsheetService = {
      ensureForTarget: vi.fn(async () => ({
        spreadsheetId: 'sheet-recovered',
        sheetName: 'Preinscripciones',
      })),
    };

    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: submissionRepo,
      submissionRecoveryRepository: recoveryRepo,
      temporaryFileStorage: mockFileStorage,
      spreadsheetRepository: mockSpreadsheetRepo,
      targetSpreadsheetService: mockTargetSpreadsheetService,
      adminSessionStore: sessionStore,
      googleIdentityVerifier: mockVerifier,
      systemSettingsRepository: new MemorySystemSettingsRepository(),
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    const session = await sessionStore.createSession({
      id: 'admin_1',
      googleSubject: 'google-sub-recovery',
      email: 'web@flacso.edu.uy',
      name: 'Web Admin',
      role: 'admin',
      createdAt: new Date(),
    });
    validCookie = `flacso_admin_session=${session.id}`;
    csrfToken = session.csrfToken;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/recoveries`);
    expect(res.status).toBe(401);
  });

  it('rejects mutations missing CSRF token with 403', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/recoveries/rec_123/retry`, {
      method: 'POST',
      headers: {
        Cookie: validCookie,
      },
    });
    expect(res.status).toBe(403);
  });

  it('lists recoveries with metadata-only (no PII in items)', async () => {
    const rec1 = await recoveryRepo.recordFailure({
      submissionId: 'sub_rec_list_1',
      targetId: 'diplomado-salud-c2',
      stage: 'sheets',
      safeError: 'Sheets append failed',
    });
    recoveryRepo.setDetails(rec1.id, {
      values: { nombres: 'Secreta', email: 'secret@flacso.edu.uy' },
    });

    const res = await fetch(`${baseUrl}/api/admin/settings/recoveries`, {
      headers: {
        Cookie: validCookie,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.recoveries).toBeInstanceOf(Array);
    const found = body.recoveries.find((r: any) => r.id === rec1.id);
    expect(found).toBeDefined();
    expect(found.submissionId).toBe('sub_rec_list_1');
    expect(found.stage).toBe('sheets');
    expect(found.status).toBe('pending');
    // Ensure no PII in list
    expect(found.values).toBeUndefined();
  });

  it('returns recovery detail with applicant values and file statuses', async () => {
    const rec = await recoveryRepo.recordFailure({
      submissionId: 'sub_rec_detail_1',
      targetId: 'diplomado-salud-c2',
      stage: 'drive',
      safeError: 'Drive timeout',
    });
    recoveryRepo.setDetails(rec.id, {
      values: { nombres: 'Valeria', email: 'valeria@example.com' },
      files: [
        {
          token: 'tok_valeria_cv',
          fieldKey: 'curriculum',
          originalName: 'cv.pdf',
          size: 1024,
          mimeType: 'application/pdf',
          status: 'failed',
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/admin/settings/recoveries/${rec.id}`, {
      headers: {
        Cookie: validCookie,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.recovery).toBeDefined();
    expect(body.recovery.id).toBe(rec.id);
    expect(body.recovery.values).toEqual({
      nombres: 'Valeria',
      email: 'valeria@example.com',
    });
    expect(body.recovery.files).toHaveLength(1);
    expect(body.recovery.files[0].originalName).toBe('cv.pdf');
  });

  it('returns 404 for non-existent recovery detail', async () => {
    const res = await fetch(`${baseUrl}/api/admin/settings/recoveries/rec_nonexistent`, {
      headers: {
        Cookie: validCookie,
      },
    });
    expect(res.status).toBe(404);
  });

  it('successfully retries a failed recovery via POST /:id/retry', async () => {
    const rec = await recoveryRepo.recordFailure({
      submissionId: 'sub_retry_route',
      targetId: 'diplomado-salud-c2',
      stage: 'sheets',
      safeError: 'Sheets quota',
    });
    recoveryRepo.setDetails(rec.id, {
      values: { nombres: 'Carlos' },
      files: [],
    });

    const res = await fetch(`${baseUrl}/api/admin/settings/recoveries/${rec.id}/retry`, {
      method: 'POST',
      headers: {
        Cookie: validCookie,
        'x-csrf-token': csrfToken,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.submissionId).toBe('sub_retry_route');

    const updated = await recoveryRepo.findById(rec.id);
    expect(updated?.status).toBe('resolved');
  });

  it('discards a recovery via DELETE /:id and removes temporary files', async () => {
    const rec = await recoveryRepo.recordFailure({
      submissionId: 'sub_discard_route',
      targetId: 'diplomado-salud-c2',
      stage: 'sheets',
      safeError: 'Discard me',
    });
    recoveryRepo.setDetails(rec.id, {
      files: [
        {
          token: 'tok_to_delete',
          fieldKey: 'titulo',
          originalName: 'titulo.pdf',
          size: 500,
          mimeType: 'application/pdf',
          status: 'pending',
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/admin/settings/recoveries/${rec.id}`, {
      method: 'DELETE',
      headers: {
        Cookie: validCookie,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Preinscripción duplicada por el usuario' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);

    const updated = await recoveryRepo.findById(rec.id);
    expect(updated?.status).toBe('discarded');
    expect(updated?.discardReason).toBe('Preinscripción duplicada por el usuario');
    expect(updated?.discardedBy).toBe('web@flacso.edu.uy');

    expect(mockFileStorage.remove).toHaveBeenCalledWith('tok_to_delete');
  });

  it('cannot discard an already resolved recovery', async () => {
    const rec = await recoveryRepo.recordFailure({
      submissionId: 'sub_resolved_discard',
      targetId: 'diplomado-salud-c2',
      stage: 'sheets',
      safeError: 'Resolved before discard',
    });
    await recoveryRepo.markRetryResult(rec.id, { success: true });

    const res = await fetch(`${baseUrl}/api/admin/settings/recoveries/${rec.id}`, {
      method: 'DELETE',
      headers: {
        Cookie: validCookie,
        'x-csrf-token': csrfToken,
      },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error?.code).toBe('CANNOT_DISCARD_RESOLVED');
  });
});
