import type { Request, Response, NextFunction } from 'express';

export interface SecurityOptions {
  allowedOrigins?: string[];
  maxJsonBodyBytes?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter {
  private readonly clients = new Map<string, RateLimitEntry>();

  constructor(
    private readonly windowMs: number = 60000,
    private readonly maxRequests: number = 100
  ) {}

  isAllowed(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.clients.get(ip);

    if (!entry || now > entry.resetAt) {
      const resetAt = now + this.windowMs;
      this.clients.set(ip, { count: 1, resetAt });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt };
    }

    if (entry.count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count += 1;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }

  // Purge expired records periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.clients.entries()) {
      if (now > value.resetAt) {
        this.clients.delete(key);
      }
    }
  }
}

export function createSecurityHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:;"
    );
    next();
  };
}

export function createCorsMiddleware(allowedOrigins: string[] = []) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (!origin) {
      // Same-origin or non-browser request
      return next();
    }

    const isAllowed =
      allowedOrigins.length === 0 ||
      allowedOrigins.includes('*') ||
      allowedOrigins.includes(origin);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Correlation-ID, X-CSRF-Token, X-Admin-Token'
      );
    }

    if (req.method === 'OPTIONS') {
      res.status(isAllowed ? 204 : 403).end();
      return;
    }

    next();
  };
}

export function createRateLimitMiddleware(limiter: MemoryRateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Get client IP
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    const check = limiter.isAllowed(clientIp);

    res.setHeader('X-RateLimit-Limit', 100);
    res.setHeader('X-RateLimit-Remaining', check.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(check.resetAt / 1000));

    if (!check.allowed) {
      res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Demasiadas solicitudes. Por favor intente más tarde.',
        retryAfterSeconds: Math.ceil((check.resetAt - Date.now()) / 1000),
      });
      return;
    }

    next();
  };
}
