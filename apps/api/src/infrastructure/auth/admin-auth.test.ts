import { describe, it, expect, vi } from 'vitest';
import { AdminAuthService } from './admin-auth.js';
import type { Request, Response, NextFunction } from 'express';

describe('AdminAuthService', () => {
  const auth = new AdminAuthService({
    username: 'admin_test',
    password: 'secure_password_456',
    sessionSecret: 'test_secret_for_tests_1234567890',
    tokenTtlSeconds: 3600,
  });

  it('validates credentials accurately with timing-safe comparison', () => {
    expect(auth.verifyCredentials('admin_test', 'secure_password_456')).toBe(true);
    expect(auth.verifyCredentials('admin_test', 'wrong_pass')).toBe(false);
    expect(auth.verifyCredentials('wrong_user', 'secure_password_456')).toBe(false);
  });

  it('creates and verifies valid session tokens', () => {
    const session = auth.createSession('admin_test');
    expect(session.token).toBeDefined();
    expect(session.csrfToken).toBeDefined();
    expect(session.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const verified = auth.verifyToken(session.token);
    expect(verified.valid).toBe(true);
    expect(verified.session?.username).toBe('admin_test');
    expect(verified.session?.csrfToken).toBe(session.csrfToken);
  });

  it('rejects tampered or malformed tokens', () => {
    const session = auth.createSession('admin_test');
    const parts = session.token.split('.');
    const tampered = `${parts[0]}.tampered_signature`;

    expect(auth.verifyToken(tampered).valid).toBe(false);
    expect(auth.verifyToken('invalid.token').valid).toBe(false);
    expect(auth.verifyToken('').valid).toBe(false);
  });

  it('rejects expired tokens', () => {
    const shortTtlAuth = new AdminAuthService({
      username: 'admin_test',
      password: 'secure_password_456',
      sessionSecret: 'test_secret_for_tests_1234567890',
      tokenTtlSeconds: -10, // already expired
    });

    const expiredSession = shortTtlAuth.createSession('admin_test');
    const verified = shortTtlAuth.verifyToken(expiredSession.token);
    expect(verified.valid).toBe(false);
  });

  describe('middleware', () => {
    it('allows requests with valid Authorization Bearer header', () => {
      const middleware = auth.createAuthMiddleware();
      const session = auth.createSession('admin_test');

      const req: Partial<Request> = {
        headers: { authorization: `Bearer ${session.token}` },
        method: 'GET',
      };
      const res: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      middleware(req as Request, res as Response, next as NextFunction);
      expect(next).toHaveBeenCalled();
      expect((req as any).admin.username).toBe('admin_test');
    });

    it('denies requests without credentials (401)', () => {
      const middleware = auth.createAuthMiddleware();
      const req: Partial<Request> = {
        headers: {},
        method: 'GET',
      };
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const res: Partial<Response> = { status: statusMock };
      const next = vi.fn();

      middleware(req as Request, res as Response, next as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('enforces CSRF check on mutating requests when cookie is used', () => {
      const middleware = auth.createAuthMiddleware();
      const session = auth.createSession('admin_test');

      // Request via cookie without X-CSRF-Token
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const reqNoCsrf: Partial<Request> = {
        headers: { cookie: `admin_token=${session.token}` },
        method: 'POST',
      };
      const resNoCsrf: Partial<Response> = { status: statusMock };
      const nextNoCsrf = vi.fn();

      middleware(reqNoCsrf as Request, resNoCsrf as Response, nextNoCsrf as NextFunction);
      expect(nextNoCsrf).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);

      // Request via cookie WITH matching X-CSRF-Token
      const reqWithCsrf: Partial<Request> = {
        headers: {
          cookie: `admin_token=${session.token}`,
          'x-csrf-token': session.csrfToken,
        },
        method: 'POST',
      };
      const nextWithCsrf = vi.fn();
      middleware(reqWithCsrf as Request, {} as Response, nextWithCsrf as NextFunction);
      expect(nextWithCsrf).toHaveBeenCalled();
    });
  });
});
