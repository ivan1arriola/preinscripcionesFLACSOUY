import crypto from 'node:crypto';
import type { Router } from 'express';
import { createAsyncRouter } from './async-router.js';
import { z } from 'zod';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';
import type { AdminUser } from '../../domain/admin-user.js';
import {
  ADMIN_SESSION_COOKIE,
  type AdminSessionStore,
  type RequestWithAdminSession,
  getAllowedAdminEmails,
  getAdminSessionTtlMs,
} from '../../application/admin-session.js';

const GoogleAuthPayloadSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().min(1),
  state: z.string().min(1),
});

const PENDING_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_STATES = 1000;

export function createAdminAuthRoutes(
  verifier: GoogleIdentityVerifierPort,
  sessionStore: AdminSessionStore
): Router {
  const router = createAsyncRouter();

  // Solicitudes de autorización en curso (state → nonce y redirectUri). Cada una se usa una sola vez.
  const pendingStates = new Map<string, { nonce: string; redirectUri: string; expiresAt: number }>();

  const purgePendingStates = (now: number) => {
    for (const [key, entry] of pendingStates) {
      if (entry.expiresAt <= now) pendingStates.delete(key);
    }
    // Tope duro: GET /google/url es público, no puede crecer sin límite.
    while (pendingStates.size >= MAX_PENDING_STATES) {
      const oldest = pendingStates.keys().next().value;
      if (oldest === undefined) break;
      pendingStates.delete(oldest);
    }
  };

  router.get('/google/url', (req, res) => {
    const redirectUri = (req.query.redirectUri as string) || '';
    if (!redirectUri) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'redirectUri es obligatorio' } });
      return;
    }
    if (!verifier.generateAuthUrl) {
      res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'generateAuthUrl no está implementado en este verificador.' } });
      return;
    }
    const now = Date.now();
    purgePendingStates(now);
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, { nonce, redirectUri, expiresAt: now + PENDING_STATE_TTL_MS });

    const url = verifier.generateAuthUrl(redirectUri, state, nonce);
    res.json({ url, state });
  });

  router.post('/google', async (req, res) => {
    const parsed = GoogleAuthPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Parámetros inválidos.',
          issues: parsed.error.issues,
        },
      });
      return;
    }

    const { code, redirectUri, state } = parsed.data;

    // El state se consume siempre (aunque el login falle): impide reutilizar un código o forzar el login
    // de otra sesión (login CSRF). El nonce que se exige al token es el guardado por el servidor.
    const pending = pendingStates.get(state);
    pendingStates.delete(state);
    if (!pending || pending.expiresAt <= Date.now() || pending.redirectUri !== redirectUri) {
      res.status(400).json({
        error: {
          code: 'INVALID_STATE',
          message: 'La solicitud de inicio de sesión expiró o no es válida. Volvé a iniciar sesión.',
        },
      });
      return;
    }

    try {
      const identity = await verifier.verify({
        code,
        redirectUri,
        expectedNonce: pending.nonce,
      });

      const allowedEmails = getAllowedAdminEmails();
      if (!allowedEmails.includes(identity.email.toLowerCase())) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Esta cuenta de Google no está autorizada para acceder al panel administrativo.',
          },
        });
        return;
      }

      if (!identity.emailVerified) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'El correo de Google no se encuentra verificado.',
          },
        });
        return;
      }

      const adminUser: AdminUser = {
        id: `admin_${identity.sub}`,
        googleSubject: identity.sub,
        email: identity.email,
        name: identity.name,
        pictureUrl: identity.picture,
        role: 'admin',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      };

      const session = await sessionStore.createSession(adminUser);

      res.cookie(ADMIN_SESSION_COOKIE, session.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: getAdminSessionTtlMs(),
      });

      res.status(200).json({
        user: {
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
          pictureUrl: adminUser.pictureUrl,
        },
        csrfToken: session.csrfToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error de autenticación';
      if (message.toLowerCase().includes('nonce')) {
        res.status(400).json({ error: { code: 'INVALID_NONCE', message } });
        return;
      }
      res.status(401).json({
        error: {
          code: 'AUTH_FAILED',
          message,
        },
      });
    }
  });

  router.post('/logout', async (req: RequestWithAdminSession, res) => {
    let sessionId: string | undefined = req.cookies?.[ADMIN_SESSION_COOKIE];
    if (!sessionId && req.headers.cookie) {
      const match = req.headers.cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`));
      if (match) sessionId = decodeURIComponent(match.split('=')[1] ?? '');
    }

    if (sessionId) {
      await sessionStore.deleteSession(sessionId);
    }

    res.clearCookie(ADMIN_SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    res.json({ ok: true });
  });

  return router;
}

export function createAdminMeRoute(sessionStore: AdminSessionStore): Router {
  const router = createAsyncRouter();

  router.get('/me', async (req, res) => {
    let sessionId: string | undefined = req.cookies?.[ADMIN_SESSION_COOKIE];
    if (!sessionId && req.headers.cookie) {
      const match = req.headers.cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`));
      if (match) sessionId = decodeURIComponent(match.split('=')[1] ?? '');
    }

    if (!sessionId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No autenticado.' } });
      return;
    }

    const session = await sessionStore.getSession(sessionId);
    if (!session) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sesión expirada.' } });
      return;
    }

    if (sessionStore.touchSession) {
      await sessionStore.touchSession(sessionId);
    }

    res.cookie(ADMIN_SESSION_COOKIE, session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: getAdminSessionTtlMs(),
    });

    res.json({
      user: {
        email: session.user.email,
        name: session.user.name,
        role: session.user.role,
        pictureUrl: session.user.pictureUrl,
      },
      csrfToken: session.csrfToken,
    });
  });

  return router;
}
