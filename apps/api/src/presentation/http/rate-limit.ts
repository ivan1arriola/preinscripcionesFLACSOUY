import type { Request, RequestHandler } from 'express';

export interface RateLimitOptions {
  /** Ventana en milisegundos. */
  windowMs: number;
  /** Cantidad máxima de eventos por clave dentro de la ventana. */
  max: number;
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Segundos hasta que la clave vuelve a tener cupo (0 si está permitido). */
  retryAfterSeconds: number;
}

/**
 * Ventana fija en memoria. Sirve para una sola instancia de la API (la actual); con varias réplicas
 * habría que moverla a PostgreSQL o Redis. Los contadores vencidos se purgan para que la tabla no crezca.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly now: () => number;
  private lastPurge = 0;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Consulta sin consumir cupo. */
  peek(key: string): RateLimitDecision {
    const bucket = this.liveBucket(key);
    if (!bucket || bucket.count < this.options.max) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - this.now()) / 1000)) };
  }

  /** Registra un evento y devuelve si todavía estaba dentro del cupo. */
  hit(key: string): RateLimitDecision {
    this.purge();
    const now = this.now();
    let bucket = this.liveBucket(key);
    if (!bucket) {
      bucket = { count: 0, resetAt: now + this.options.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > this.options.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private liveBucket(key: string) {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private purge() {
    const now = this.now();
    if (now - this.lastPurge < this.options.windowMs) return;
    this.lastPurge = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export function rateLimitedResponse(retryAfterSeconds: number) {
  return {
    error: {
      code: 'RATE_LIMITED',
      message: 'Recibimos demasiadas solicitudes desde tu conexión. Esperá unos minutos e intentá de nuevo.',
      retryAfterSeconds,
    },
  };
}

/** Middleware que limita por IP (ver `trust proxy` en app.ts para que `req.ip` sea la del visitante). */
export function createIpRateLimit(
  options: RateLimitOptions,
  keyFor: (req: Request) => string = (req) => req.ip ?? 'desconocida',
): RequestHandler {
  const limiter = new RateLimiter(options);
  return (req, res, next) => {
    const decision = limiter.hit(keyFor(req));
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      res.status(429).json(rateLimitedResponse(decision.retryAfterSeconds));
      return;
    }
    next();
  };
}
