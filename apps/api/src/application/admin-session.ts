import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AdminUser } from '../domain/admin-user.js';

export const getAllowedAdminEmails = (): string[] => {
  const envVal = process.env.ADMIN_ALLOWED_EMAILS;
  if (envVal) {
    return envVal.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  }
  return ['web@flacso.edu.uy'];
};

export const getAdminSessionTtlMs = (): number => {
  const envVal = process.env.ADMIN_SESSION_TTL_MINUTES;
  if (envVal) {
    const mins = parseInt(envVal, 10);
    if (!isNaN(mins) && mins > 0) {
      // Ensure at least 15 minutes of session persistence
      return Math.max(15, mins) * 60 * 1000;
    }
  }
  // Default: 12 hours (720 minutes, >= 15 min)
  return 12 * 60 * 60 * 1000;
};

export const ALLOWED_ADMIN_EMAIL = 'web@flacso.edu.uy';
export const ADMIN_SESSION_COOKIE = 'flacso_admin_session';

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
  touchSession?(sessionId: string): Promise<Date | null>;
}

export class MemoryAdminSessionStore implements AdminSessionStore {
  private readonly sessions = new Map<string, AdminSession>();

  constructor(private readonly ttlMs: number = getAdminSessionTtlMs()) {}

  async createSession(user: AdminUser): Promise<AdminSession> {
    const id = `sess_${crypto.randomBytes(32).toString('hex')}`;
    const csrfToken = `csrf_${crypto.randomBytes(24).toString('hex')}`;
    const now = new Date();
    const session: AdminSession = {
      id,
      user,
      csrfToken,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
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

  async touchSession(sessionId: string): Promise<Date | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const now = new Date();
    if (session.expiresAt.getTime() <= now.getTime()) {
      this.sessions.delete(sessionId);
      return null;
    }
    session.expiresAt = new Date(now.getTime() + this.ttlMs);
    return session.expiresAt;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export interface RequestWithAdminSession extends Request {
  adminUser?: AdminUser;
  adminSession?: AdminSession;
}

// cookie-parser ya corre en createApp antes de cualquier ruta admin: no hace falta leer la cabecera a mano.
function extractSessionId(req: Request): string | null {
  return req.cookies?.[ADMIN_SESSION_COOKIE] || null;
}

/** Comparación en tiempo constante: el token CSRF no debe poder deducirse midiendo respuestas. */
function csrfTokenMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
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

    if (sessionStore.touchSession) {
      await sessionStore.touchSession(sessionId);
    }

    // CSRF check for state mutations
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    if (isMutation) {
      if (!csrfTokenMatches(req.headers['x-csrf-token'], session.csrfToken)) {
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
