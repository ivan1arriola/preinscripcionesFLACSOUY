import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';
import type { AdminUser } from '../../domain/form-profiles.js';
import {
  ALLOWED_ADMIN_EMAIL,
  ADMIN_SESSION_COOKIE,
  type AdminSessionStore,
  type RequestWithAdminSession,
  getAdminSessionTtlMs,
} from '../../application/admin-session.js';

const GoogleAuthPayloadSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().min(1),
  nonce: z.string().optional(),
});

export function createAdminAuthRoutes(
  verifier: GoogleIdentityVerifierPort,
  sessionStore: AdminSessionStore
): Router {
  const router = Router();

  // In-memory state/nonce cache for authorization requests (TTL 10 min)
  const pendingStates = new Map<string, { nonce: string; expiresAt: number }>();

  router.get('/google/url', (req, res) => {
    const redirectUri = (req.query.redirectUri as string) || '';
    if (!redirectUri) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'redirectUri es obligatorio' } });
      return;
    }
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, { nonce, expiresAt: Date.now() + 10 * 60 * 1000 });

    if (!verifier.generateAuthUrl) {
      res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'generateAuthUrl no está implementado en este verificador.' } });
      return;
    }
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

    const { code, redirectUri, nonce } = parsed.data;

    try {
      const identity = await verifier.verify({
        code,
        redirectUri,
        expectedNonce: nonce,
      });

      if (identity.email.toLowerCase() !== ALLOWED_ADMIN_EMAIL) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: `El correo "${identity.email}" no está autorizado para acceder al panel administrativo. Solo está autorizado ${ALLOWED_ADMIN_EMAIL}.`,
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
        id: 'admin_flacso_web',
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
  const router = Router();

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
