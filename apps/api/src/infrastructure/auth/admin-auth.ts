import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface AdminAuthConfig {
  username?: string;
  password?: string;
  sessionSecret?: string;
  tokenTtlSeconds?: number;
}

export interface AdminSession {
  username: string;
  csrfToken: string;
  expiresAt: number;
}

export class AdminAuthService {
  private readonly username: string;
  private readonly passwordHash: Buffer;
  private readonly secret: string;
  private readonly tokenTtlSeconds: number;

  constructor(config: AdminAuthConfig = {}) {
    this.username = config.username || process.env.ADMIN_USERNAME || 'admin';
    const rawPass = config.password || process.env.ADMIN_PASSWORD || 'flacso_admin_2026';
    this.passwordHash = crypto.createHash('sha256').update(rawPass).digest();
    this.secret =
      config.sessionSecret ||
      process.env.ADMIN_SESSION_SECRET ||
      'flacso_admin_dev_secret_key_change_in_production_32b';
    this.tokenTtlSeconds = config.tokenTtlSeconds || 8 * 3600; // 8 hours
  }

  verifyCredentials(user: string, pass: string): boolean {
    if (user !== this.username) {
      return false;
    }
    const inputHash = crypto.createHash('sha256').update(pass).digest();
    return crypto.timingSafeEqual(inputHash, this.passwordHash);
  }

  createSession(username: string): { token: string; csrfToken: string; expiresAt: number } {
    const expiresAt = Math.floor(Date.now() / 1000) + this.tokenTtlSeconds;
    const csrfToken = crypto.randomBytes(16).toString('hex');
    const payload = `${username}:${expiresAt}:${csrfToken}`;
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('base64url');

    const token = `${Buffer.from(payload).toString('base64url')}.${signature}`;
    return { token, csrfToken, expiresAt };
  }

  verifyToken(token: string): { valid: boolean; session?: AdminSession } {
    if (!token || typeof token !== 'string') {
      return { valid: false };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false };
    }

    const [payloadB64, sig] = parts;
    if (!payloadB64 || !sig) {
      return { valid: false };
    }

    const expectedSig = crypto
      .createHmac('sha256', this.secret)
      .update(Buffer.from(payloadB64, 'base64url').toString('utf8'))
      .digest('base64url');

    if (sig.length !== expectedSig.length) {
      return { valid: false };
    }

    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false };
    }

    try {
      const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const [username, expStr, csrfToken] = payloadStr.split(':');
      if (!username || !expStr || !csrfToken) {
        return { valid: false };
      }
      const expiresAt = parseInt(expStr, 10);

      if (Math.floor(Date.now() / 1000) > expiresAt) {
        return { valid: false };
      }

      return {
        valid: true,
        session: { username, csrfToken, expiresAt },
      };
    } catch {
      return { valid: false };
    }
  }

  createAuthMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      let token: string | undefined;

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      } else if (req.headers['x-admin-token']) {
        token = String(req.headers['x-admin-token']);
      } else if (req.headers.cookie) {
        const match = req.headers.cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
        if (match) {
          token = match[1];
        }
      }

      if (!token) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Se requiere autenticación de administrador',
        });
        return;
      }

      const verified = this.verifyToken(token);
      if (!verified.valid || !verified.session) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Sesión de administrador inválida o expirada',
        });
        return;
      }

      // CSRF check for state-mutating methods if cookie auth was used
      const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      const isCookieAuth = !authHeader && !req.headers['x-admin-token'] && req.headers.cookie;

      if (isMutating && isCookieAuth) {
        const csrfHeader = req.headers['x-csrf-token'];
        if (!csrfHeader || csrfHeader !== verified.session.csrfToken) {
          res.status(403).json({
            error: 'CSRF_FAILED',
            message: 'Token CSRF inválido o ausente',
          });
          return;
        }
      }

      (req as any).admin = verified.session;
      next();
    };
  }
}
