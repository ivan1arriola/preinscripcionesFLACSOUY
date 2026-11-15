import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { MemoryAdminSessionStore } from '../../application/admin-session.js';
import { MemorySystemSettingsRepository } from '../../infrastructure/fixtures/memory-system-settings-repository.js';
import { EncryptedSettingsService } from '../../infrastructure/security/encrypted-settings.js';
import {
  RECAPTCHA_ACTION,
  loadRecaptchaConfig,
  saveRecaptchaConfig,
  verifyRecaptchaToken,
  type RecaptchaVerification,
  type RecaptchaVerifier,
} from '../../infrastructure/recaptcha/recaptcha.js';

const MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

describe('verifyRecaptchaToken', () => {
  const base = { secretKey: 'secreto', token: 'token', minScore: 0.5, expectedAction: RECAPTCHA_ACTION };

  it('passes a token with enough score for the expected action', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, score: 0.9, action: RECAPTCHA_ACTION }));
    const result = await verifyRecaptchaToken({ ...base, remoteIp: '203.0.113.5', fetchImpl });

    expect(result).toEqual({ status: 'passed', score: 0.9 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(String(init.body)).toContain('secret=secreto');
    expect(String(init.body)).toContain('remoteip=203.0.113.5');
  });

  it('rejects a missing token, a low score, a wrong action and a refused token', async () => {
    expect(await verifyRecaptchaToken({ ...base, token: undefined })).toEqual({ status: 'failed', reason: 'missing_token' });

    const low = vi.fn().mockResolvedValue(jsonResponse({ success: true, score: 0.1, action: RECAPTCHA_ACTION }));
    expect(await verifyRecaptchaToken({ ...base, fetchImpl: low })).toEqual({ status: 'failed', reason: 'low_score' });

    const wrongAction = vi.fn().mockResolvedValue(jsonResponse({ success: true, score: 0.9, action: 'otra' }));
    expect(await verifyRecaptchaToken({ ...base, fetchImpl: wrongAction })).toEqual({ status: 'failed', reason: 'wrong_action' });

    const refused = vi.fn().mockResolvedValue(jsonResponse({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await verifyRecaptchaToken({ ...base, fetchImpl: refused })).toEqual({ status: 'failed', reason: 'rejected' });
  });

  it('reports unavailable (instead of failing) when Google does not answer', async () => {
    const down = vi.fn().mockRejectedValue(new Error('timeout'));
    expect(await verifyRecaptchaToken({ ...base, fetchImpl: down })).toEqual({ status: 'unavailable' });

    const serverError = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    expect(await verifyRecaptchaToken({ ...base, fetchImpl: serverError })).toEqual({ status: 'unavailable' });
  });
});

describe('reCAPTCHA in the HTTP app', () => {
  async function withApp(
    recaptchaVerifier: RecaptchaVerifier,
    configure: (settings: EncryptedSettingsService) => Promise<void>,
    run: (ctx: { baseUrl: string; settings: EncryptedSettingsService; sessionStore: MemoryAdminSessionStore }) => Promise<void>,
  ) {
    const settingsRepository = new MemorySystemSettingsRepository();
    const settings = new EncryptedSettingsService(settingsRepository, MASTER_KEY);
    const sessionStore = new MemoryAdminSessionStore();
    await configure(settings);

    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      systemSettingsRepository: settingsRepository,
      encryptedSettingsService: settings,
      adminSessionStore: sessionStore,
      recaptchaVerifier,
      rateLimits: false,
    });
    let server!: Server;
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    try {
      const address = server.address();
      await run({ baseUrl: `http://localhost:${typeof address === 'object' && address ? address.port : 0}`, settings, sessionStore });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  const enable = (settings: EncryptedSettingsService) =>
    saveRecaptchaConfig(settings, { enabled: true, siteKey: 'sitio-publico', secretKey: 'clave-secreta' });

  const submit = (baseUrl: string, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    });

  it('does not require a token while reCAPTCHA is not enabled', async () => {
    const verifier = vi.fn();
    await withApp(verifier, async () => undefined, async ({ baseUrl }) => {
      // Llega hasta la validación del cuerpo (400), no se corta con 403.
      expect((await submit(baseUrl)).status).toBe(400);
      expect(verifier).not.toHaveBeenCalled();
    });
  });

  it('blocks a submission without a valid token once enabled, and lets a verified one through', async () => {
    const verifier: RecaptchaVerifier = async ({ token }): Promise<RecaptchaVerification> =>
      token === 'bueno'
        ? { status: 'passed', score: 0.9 }
        : { status: 'failed', reason: token ? 'low_score' : 'missing_token' };

    await withApp(verifier, enable, async ({ baseUrl }) => {
      const missing = await submit(baseUrl);
      expect(missing.status).toBe(403);
      expect((await missing.json()).error.code).toBe('CAPTCHA_FAILED');

      expect((await submit(baseUrl, { 'x-recaptcha-token': 'malo' })).status).toBe(403);
      expect((await submit(baseUrl, { 'x-recaptcha-token': 'bueno' })).status).toBe(400);
    });
  });

  it('keeps the form working when Google is unreachable', async () => {
    const verifier: RecaptchaVerifier = async () => ({ status: 'unavailable' });
    await withApp(verifier, enable, async ({ baseUrl }) => {
      expect((await submit(baseUrl, { 'x-recaptcha-token': 'cualquiera' })).status).toBe(400);
    });
  });

  it('publishes only the public site key at /api/config', async () => {
    await withApp(async () => ({ status: 'passed', score: 1 }), enable, async ({ baseUrl }) => {
      const body = await (await fetch(`${baseUrl}/api/config`)).json();
      expect(body).toEqual({ meta: { pixelId: null }, recaptcha: { enabled: true, siteKey: 'sitio-publico', action: RECAPTCHA_ACTION } });
      expect(JSON.stringify(body)).not.toContain('clave-secreta');
    });

    await withApp(async () => ({ status: 'passed', score: 1 }), async () => undefined, async ({ baseUrl }) => {
      expect(await (await fetch(`${baseUrl}/api/config`)).json()).toEqual({ meta: { pixelId: null }, recaptcha: { enabled: false } });
    });
  });

  describe('admin settings', () => {
    async function adminHeaders(sessionStore: MemoryAdminSessionStore) {
      const session = await sessionStore.createSession({
        id: 'admin_1', googleSubject: 'sub', email: 'web@flacso.edu.uy', name: 'Admin', role: 'admin',
        createdAt: new Date(), lastLoginAt: new Date(),
      });
      return { Cookie: `flacso_admin_session=${session.id}`, 'x-csrf-token': session.csrfToken, 'Content-Type': 'application/json' };
    }

    it('requires an admin session', async () => {
      await withApp(async () => ({ status: 'passed', score: 1 }), async () => undefined, async ({ baseUrl }) => {
        expect((await fetch(`${baseUrl}/api/admin/settings/recaptcha`)).status).toBe(401);
        const put = await fetch(`${baseUrl}/api/admin/settings/recaptcha`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true, siteKey: 'a', secretKey: 'b' }),
        });
        expect(put.status).toBe(401);
      });
    });

    it('saves the keys encrypted, never returns the secret and keeps it when left blank', async () => {
      await withApp(async () => ({ status: 'passed', score: 1 }), async () => undefined, async ({ baseUrl, settings, sessionStore }) => {
        const headers = await adminHeaders(sessionStore);

        const saved = await fetch(`${baseUrl}/api/admin/settings/recaptcha`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ enabled: true, siteKey: 'sitio-publico', secretKey: 'clave-secreta', minScore: 0.7 }),
        });
        expect(saved.status).toBe(200);
        const savedBody = await saved.json();
        expect(savedBody.recaptcha).toEqual({ enabled: true, siteKey: 'sitio-publico', minScore: 0.7, hasSecretKey: true });
        expect(JSON.stringify(savedBody)).not.toContain('clave-secreta');

        // Guardar de nuevo sin secreto conserva el existente.
        const again = await fetch(`${baseUrl}/api/admin/settings/recaptcha`, {
          method: 'PUT', headers, body: JSON.stringify({ siteKey: 'sitio-nuevo', secretKey: '' }),
        });
        expect(again.status).toBe(200);
        const config = await loadRecaptchaConfig(settings);
        expect(config.secretKey).toBe('clave-secreta');
        expect(config.siteKey).toBe('sitio-nuevo');
      });
    });

    it('refuses to enable reCAPTCHA without both keys', async () => {
      await withApp(async () => ({ status: 'passed', score: 1 }), async () => undefined, async ({ baseUrl, sessionStore }) => {
        const response = await fetch(`${baseUrl}/api/admin/settings/recaptcha`, {
          method: 'PUT',
          headers: await adminHeaders(sessionStore),
          body: JSON.stringify({ enabled: true, siteKey: 'solo-sitio' }),
        });
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_RECAPTCHA_CONFIG');
      });
    });
  });
});
