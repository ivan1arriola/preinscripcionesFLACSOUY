import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';

const removedProfileDefinition = { steps: [], fields: [], documents: [] };

describe('Removed Admin Profile HTTP Routes', () => {
  let server: Server;
  let baseUrl: string;
  let sessionCookie: string;
  let csrfToken: string;
  const previousAllowedEmails = process.env.ADMIN_ALLOWED_EMAILS;

  const mockVerifier: GoogleIdentityVerifierPort = {
    generateAuthUrl: (_redirectUri, state) => `https://accounts.example.test/auth?state=${state}`,
    verify: async () => ({
      sub: 'sub-admin-test-1',
      email: 'admin@example.test',
      emailVerified: true,
      name: 'Admin Test',
    }),
  };

  beforeAll(async () => {
    process.env.ADMIN_ALLOWED_EMAILS = 'admin@example.test';
    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      googleIdentityVerifier: mockVerifier,
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

    const urlRes = await fetch(`${baseUrl}/api/admin/auth/google/url?redirectUri=${encodeURIComponent('https://example.com')}`);
    const { state } = await urlRes.json();
    const authRes = await fetch(`${baseUrl}/api/admin/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'valid-code', redirectUri: 'https://example.com', state }),
    });
    sessionCookie = (authRes.headers.get('set-cookie')?.split(';')[0]) ?? '';
    csrfToken = (await authRes.json()).csrfToken;
  });

  afterAll(async () => {
    if (previousAllowedEmails === undefined) {
      delete process.env.ADMIN_ALLOWED_EMAILS;
    } else {
      process.env.ADMIN_ALLOWED_EMAILS = previousAllowedEmails;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns 404 across all removed profile endpoints (anonymous and authenticated)', async () => {
    const anonymousGet = await fetch(`${baseUrl}/api/admin/profiles`);
    expect(anonymousGet.status).toBe(404);

    const authGetList = await fetch(`${baseUrl}/api/admin/profiles`, { headers: { Cookie: sessionCookie } });
    expect(authGetList.status).toBe(404);

    const authGetOne = await fetch(`${baseUrl}/api/admin/profiles/diploma`, { headers: { Cookie: sessionCookie } });
    expect(authGetOne.status).toBe(404);

    const authPostVersion = await fetch(`${baseUrl}/api/admin/profiles/diploma/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ definition: removedProfileDefinition }),
    });
    expect(authPostVersion.status).toBe(404);

    const authActivate = await fetch(`${baseUrl}/api/admin/profiles/diploma/activate/legacy-v1`, {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'x-csrf-token': csrfToken },
    });
    expect(authActivate.status).toBe(404);
  });
});
