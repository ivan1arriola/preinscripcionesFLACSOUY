import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';

describe('Admin Auth HTTP Routes', () => {
  let server: Server;
  let baseUrl: string;

  const mockVerifier: GoogleIdentityVerifierPort = {
    verify: async ({ code }) => {
      if (code === 'code-unauthorized-email') {
        return {
          sub: 'sub-other',
          email: 'otro@gmail.com',
          emailVerified: true,
          name: 'Otro Usuario',
        };
      }
      if (code === 'code-unverified-email') {
        return {
          sub: 'sub-unverified',
          email: 'web@flacso.edu.uy',
          emailVerified: false,
          name: 'Unverified Admin',
        };
      }
      if (code === 'code-bad-nonce') {
        throw new Error('Invalid nonce in identity token');
      }
      if (code === 'code-valid-webmaster') {
        return {
          sub: 'sub-webmaster-1',
          email: 'web@flacso.edu.uy',
          emailVerified: true,
          name: 'Webmaster FLACSO',
          picture: 'https://flacso.edu.uy/avatar.jpg',
        };
      }
      throw new Error(`Invalid code: ${code}`);
    },
  };

  beforeAll(async () => {
    const catalog = new FixtureAcademicCatalog();
    const repository = new InMemorySubmissionRepository();
    const app = createApp({
      catalog,
      repository,
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
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects authentication for non-whitelisted email (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code-unauthorized-email',
        redirectUri: 'https://example.com/callback',
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.code).toBe('FORBIDDEN');
    expect(data.error.message).toMatch(/autorizado/i);
  });

  it('rejects authentication when email is unverified by Google (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code-unverified-email',
        redirectUri: 'https://example.com/callback',
      }),
    });

    expect(res.status).toBe(403);
  });

  it('rejects authentication on bad nonce (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code-bad-nonce',
        redirectUri: 'https://example.com/callback',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('authenticates verified web@flacso.edu.uy, issues secure session cookie and CSRF token', async () => {
    const res = await fetch(`${baseUrl}/api/admin/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'code-valid-webmaster',
        redirectUri: 'https://example.com/callback',
      }),
    });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/flacso_admin_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const body = await res.json();
    expect(body.user.email).toBe('web@flacso.edu.uy');
    expect(body.user.role).toBe('admin');
    expect(body.csrfToken).toBeDefined();

    const cookieHeader = (setCookie?.split(';')[0]) ?? '';

    // Verify session via GET /api/admin/me
    const meRes = await fetch(`${baseUrl}/api/admin/me`, {
      headers: { Cookie: cookieHeader },
    });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.user.email).toBe('web@flacso.edu.uy');
    expect(meData.csrfToken).toBeDefined();

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/admin/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'x-csrf-token': body.csrfToken,
      },
    });
    expect(logoutRes.status).toBe(200);

    // Subsequent /me should return 401
    const postLogoutMe = await fetch(`${baseUrl}/api/admin/me`, {
      headers: { Cookie: cookieHeader },
    });
    expect(postLogoutMe.status).toBe(401);
  });

  it('GET /api/admin/me returns 401 when not authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/admin/me`);
    expect(res.status).toBe(401);
  });
});
