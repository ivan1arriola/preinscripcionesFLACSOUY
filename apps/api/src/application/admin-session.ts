import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AdminUser } from '../domain/form-profiles.js';

export const ALLOWED_ADMIN_EMAIL = 'web@flacso.edu.uy';
export const ADMIN_SESSION_COOKIE = 'flacso_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface AdminSession {
  id: string;
  user: AdminUser;
  csrfToken: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AdminSessionStore {
  createSession(user: AdminUser): Promise<AdminSession>;
  getSession(sessionId: string): Promise<AdminSession | null>;
  deleteSession(sessionId: string): Promise<void>;
}

export class MemoryAdminSessionStore implements AdminSessionStore {
  private readonly sessions = new Map<string, AdminSession>();

  async createSession(user: AdminUser): Promise<AdminSession> {
    const id = `sess_${crypto.randomBytes(32).toString('hex')}`;
    const csrfToken = `csrf_${crypto.randomBytes(24).toString('hex')}`;
    const now = new Date();
    const session: AdminSession = {
      id,
      user,
      csrfToken,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    };
    this.sessions.set(id, session);
    return session;
  }

  async getSession(sessionId: string): Promise<AdminSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export interface RequestWithAdminSession extends Request {
  adminUser?: AdminUser;
  adminSession?: AdminSession;
}

function extractSessionId(req: Request): string | null {
  if (req.cookies && req.cookies[ADMIN_SESSION_COOKIE]) {
    return req.cookies[ADMIN_SESSION_COOKIE];
  }
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  if (!match) return null;
  return decodeURIComponent(match.split('=')[1] ?? '');
}

export function createRequireAdminSession(sessionStore: AdminSessionStore) {
  return async (req: RequestWithAdminSession, res: Response, next: NextFunction): Promise<void> => {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Se requiere una sesión administrativa activa.',
        },
      });
      return;
    }

    const session = await sessionStore.getSession(sessionId);
    if (!session) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sesión administrativa inválida o expirada.',
        },
      });
      return;
    }

    // CSRF check for state mutations
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    if (isMutation) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || csrfHeader !== session.csrfToken) {
        res.status(403).json({
          error: {
            code: 'INVALID_CSRF_TOKEN',
            message: 'Token CSRF inválido o ausente.',
          },
        });
        return;
      }
    }

    req.adminUser = session.user;
    req.adminSession = session;
    next();
  };
}
