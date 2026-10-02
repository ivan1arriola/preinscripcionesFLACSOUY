import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { AdminAuthService } from '../../infrastructure/auth/admin-auth.js';
import { AdminService } from '../../application/admin/admin-service.js';
import type { SystemErrorRepository } from '../../ports/system-error-repository.js';
import { createSystemError } from '../../domain/system-error.js';

describe('Admin HTTP Routes', () => {
  let server: Server;
  let baseUrl: string;
  let authService: AdminAuthService;
  let adminService: AdminService;
  let adminToken: string;
  let csrfToken: string;

  const mockError = createSystemError({
    id: 'test-err-99',
    severity: 'high',
    origin: 'drive',
    code: 'DRIVE_PERMISSION_DENIED',
    message: 'Permiso denegado en carpeta de Google Drive',
    context: { folderId: 'folder-abc', secretToken: 'not-leaked' },
    targetId: 'davia-c11',
  });

  const inMemoryErrors = [mockError];
  const mockErrorRepo: SystemErrorRepository = {
    save: async () => {},
    findById: async (id) => inMemoryErrors.find((e) => e.id === id) || null,
    findMany: async () => inMemoryErrors,
    resolve: async (id, user) => {
      const err = inMemoryErrors.find((e) => e.id === id);
      if (!err) return null;
      err.status = 'resolved';
      err.resolvedBy = user;
      err.resolvedAt = new Date().toISOString();
      return err;
    },
  };

  beforeAll(async () => {
    const catalog = new FixtureAcademicCatalog();
    const repository = new InMemorySubmissionRepository();

    authService = new AdminAuthService({
      username: 'admin',
      password: 'test_password_123',
      sessionSecret: 'test_secret_for_admin_routes',
    });

    adminService = new AdminService({
      catalog,
      errorRepo: mockErrorRepo,
      checkDatabase: async () => true,
    });

    const app = createApp({
      catalog,
      repository,
      authService,
      adminService,
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

  it('rejects unauthenticated requests to /api/admin/targets with 401', async () => {
    const res = await fetch(`${baseUrl}/api/admin/targets`);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('rejects invalid login credentials with 401', async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
    });

    expect(res.status).toBe(401);
  });

  it('authenticates valid admin credentials and returns tokens', async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test_password_123' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.csrfToken).toBeDefined();
    expect(body.user.username).toBe('admin');

    adminToken = body.token;
    csrfToken = body.csrfToken;
  });

  it('verifies /api/admin/me returns current admin identity with Bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/admin/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.username).toBe('admin');
  });

  it('GET /api/admin/targets returns detected forms with diagnostics', async () => {
    const res = await fetch(`${baseUrl}/api/admin/targets`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const targets = await res.json();
    expect(Array.isArray(targets)).toBe(true);
    expect(targets.length).toBeGreaterThan(0);

    const davia = targets.find((t: any) => t.id === 'davia-c11');
    expect(davia).toBeDefined();
    expect(davia.status).toBe('operational');
  });

  it('GET /api/admin/targets/:id/diagnostics returns detailed diagnostic', async () => {
    const res = await fetch(`${baseUrl}/api/admin/targets/davia-c11/diagnostics`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const diag = await res.json();
    expect(diag.targetId).toBe('davia-c11');
    expect(diag.wordpress.valid).toBe(true);
    expect(diag.wordpress.status).toBe('ok');
    expect(diag.status).toBe('healthy');
  });

  it('GET /api/admin/errors returns system errors without leaking redacted secrets', async () => {
    const res = await fetch(`${baseUrl}/api/admin/errors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const errors = await res.json();
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);

    const err = errors.find((e: any) => e.id === 'test-err-99');
    expect(err).toBeDefined();
    expect(err.code).toBe('DRIVE_PERMISSION_DENIED');
    expect(err.context.secretToken).toBe('[REDACTED]');
  });

  it('POST /api/admin/errors/:id/resolve resolves error successfully', async () => {
    const res = await fetch(`${baseUrl}/api/admin/errors/test-err-99/resolve`, {
      method: 'POST',
      headers: {
        Cookie: `admin_token=${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
    });

    expect(res.status).toBe(200);
    const resolved = await res.json();
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('admin');
  });

  it('GET /api/admin/health/integrations returns status of all integrations', async () => {
    const res = await fetch(`${baseUrl}/api/admin/health/integrations`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const health = await res.json();
    expect(health.status).toBeDefined();
    expect(health.integrations.database.status).toBe('healthy');
    expect(health.integrations.wordpress.status).toBe('healthy');
  });
});
