import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { MemoryFormProfileRepository } from '../../infrastructure/fixtures/memory-form-profile-repository.js';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';
import { getDefaultProfileDefinition } from '../../domain/form-profiles.js';

describe('Admin Profile HTTP Routes', () => {
  let server: Server;
  let baseUrl: string;
  let profileRepo: MemoryFormProfileRepository;
  let sessionCookie: string;
  let csrfToken: string;

  const mockVerifier: GoogleIdentityVerifierPort = {
    verify: async () => ({
      sub: 'sub-webmaster-1',
      email: 'web@flacso.edu.uy',
      emailVerified: true,
      name: 'Webmaster FLACSO',
    }),
  };

  beforeAll(async () => {
    const catalog = new FixtureAcademicCatalog();
    const repository = new InMemorySubmissionRepository();
    profileRepo = new MemoryFormProfileRepository();

    const app = createApp({
      catalog,
      repository,
      formProfileRepository: profileRepo,
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

    // Authenticate as web@flacso.edu.uy to obtain session
    const authRes = await fetch(`${baseUrl}/api/admin/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'valid-code', redirectUri: 'https://example.com' }),
    });
    const setCookie = authRes.headers.get('set-cookie');
    sessionCookie = (setCookie?.split(';')[0]) ?? '';
    const data = await authRes.json();
    csrfToken = data.csrfToken;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/admin/profiles`);
    expect(res.status).toBe(401);

    const postRes = await fetch(`${baseUrl}/api/admin/profiles/diploma/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: getDefaultProfileDefinition('diploma') }),
    });
    expect(postRes.status).toBe(401);
  });

  it('rejects mutation requests without valid CSRF header with 403', async () => {
    const res = await fetch(`${baseUrl}/api/admin/profiles/diploma/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'x-csrf-token': 'wrong-csrf-token',
      },
      body: JSON.stringify({ definition: getDefaultProfileDefinition('diploma') }),
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/profiles lists all profiles', async () => {
    const res = await fetch(`${baseUrl}/api/admin/profiles`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profiles).toHaveLength(5);
    const types = data.profiles.map((p: any) => p.type);
    expect(types).toContain('maestria');
    expect(types).toContain('especializacion');
    expect(types).toContain('diplomado');
    expect(types).toContain('diploma');
    expect(types).toContain('seminar');
  });

  it('GET /api/admin/profiles/:type returns profile with active version and history', async () => {
    const res = await fetch(`${baseUrl}/api/admin/profiles/diploma`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profile.type).toBe('diploma');
    expect(data.activeVersion).toBeDefined();
    expect(data.activeVersion.versionNumber).toBe(1);
    expect(data.versions).toHaveLength(1);
  });

  it('POST /api/admin/profiles/:type/versions returns 410 with PROFILES_DISABLED', async () => {
    const res = await fetch(`${baseUrl}/api/admin/profiles/diploma/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        definition: getDefaultProfileDefinition('diploma'),
      }),
    });
    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.error.code).toBe('PROFILES_DISABLED');
    expect(data.error.message).toContain('ya no está disponible');
  });

  it('POST /api/admin/profiles/:type/activate/:versionId returns 410 with PROFILES_DISABLED', async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/profiles/diploma/activate/ver_diploma_v1`,
      {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'x-csrf-token': csrfToken,
        },
      }
    );
    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.error.code).toBe('PROFILES_DISABLED');
    expect(data.error.message).toContain('ya no está disponible');
  });
});

