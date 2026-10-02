import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  createSecurityHeadersMiddleware,
  createCorsMiddleware,
  createRateLimitMiddleware,
  MemoryRateLimiter,
} from './security.js';
import {
  StructuredLogger,
  createCorrelationIdMiddleware,
} from '../../infrastructure/observability/logger.js';

describe('Security & Observability', () => {
  describe('Security Headers Middleware', () => {
    it('sets protective security headers on response', () => {
      const middleware = createSecurityHeadersMiddleware();
      const headers: Record<string, string> = {};
      const res: Partial<Response> = {
        setHeader: (k: string, v: string) => {
          headers[k.toLowerCase()] = v;
          return res as Response;
        },
      };
      const next = vi.fn();

      middleware({} as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['content-security-policy']).toBeDefined();
    });
  });

  describe('CORS Middleware', () => {
    it('allows specified origin and handles OPTIONS preflight', () => {
      const middleware = createCorsMiddleware(['https://flacso.edu.uy']);
      const headers: Record<string, string> = {};
      const statusMock = vi.fn().mockReturnThis();
      const endMock = vi.fn();

      const req: Partial<Request> = {
        method: 'OPTIONS',
        headers: { origin: 'https://flacso.edu.uy' },
      };
      const res: Partial<Response> = {
        setHeader: (k: string, v: string) => {
          headers[k.toLowerCase()] = v;
          return res as Response;
        },
        status: statusMock,
        end: endMock,
      };
      const next = vi.fn();

      middleware(req as Request, res as Response, next as NextFunction);

      expect(headers['access-control-allow-origin']).toBe('https://flacso.edu.uy');
      expect(statusMock).toHaveBeenCalledWith(204);
      expect(endMock).toHaveBeenCalled();
    });

    it('rejects disallowed origin on OPTIONS preflight', () => {
      const middleware = createCorsMiddleware(['https://flacso.edu.uy']);
      const statusMock = vi.fn().mockReturnThis();
      const endMock = vi.fn();

      const req: Partial<Request> = {
        method: 'OPTIONS',
        headers: { origin: 'https://malicious-site.com' },
      };
      const res: Partial<Response> = {
        setHeader: vi.fn(),
        status: statusMock,
        end: endMock,
      };

      middleware(req as Request, res as Response, vi.fn());
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(endMock).toHaveBeenCalled();
    });
  });

  describe('Rate Limiter', () => {
    it('blocks requests after limit exceeded within window', () => {
      const limiter = new MemoryRateLimiter(10000, 2);
      const middleware = createRateLimitMiddleware(limiter);

      const makeReq = () => {
        const headers: Record<string, any> = {};
        const jsonMock = vi.fn();
        const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
        const req: Partial<Request> = {
          headers: { 'x-forwarded-for': '192.168.1.50' },
          socket: {} as any,
        };
        const res: Partial<Response> = {
          setHeader: (k: string, v: any) => {
            headers[k] = v;
            return res as Response;
          },
          status: statusMock,
        };
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);
        return { next, statusMock, jsonMock };
      };

      // 1st request -> allowed
      const r1 = makeReq();
      expect(r1.next).toHaveBeenCalled();

      // 2nd request -> allowed
      const r2 = makeReq();
      expect(r2.next).toHaveBeenCalled();

      // 3rd request -> blocked with 429
      const r3 = makeReq();
      expect(r3.next).not.toHaveBeenCalled();
      expect(r3.statusMock).toHaveBeenCalledWith(429);
      expect(r3.jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'RATE_LIMIT_EXCEEDED' })
      );
    });
  });

  describe('Structured Logger & Correlation ID', () => {
    it('attaches correlation ID header to incoming and outgoing request', () => {
      const middleware = createCorrelationIdMiddleware();
      const headers: Record<string, string> = {};
      const req: any = { headers: {} };
      const res: any = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
      };
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.correlationId).toBeDefined();
      expect(headers['X-Correlation-ID']).toBe(req.correlationId);
    });

    it('redacts sensitive fields in log payloads', () => {
      const loggedLines: string[] = [];
      const testLogger = new StructuredLogger((line) => loggedLines.push(line));

      testLogger.info(
        'User submission processed',
        {
          targetId: 'davia-c11',
          email: 'estudiante@correo.com',
          password: 'secret_value',
          authToken: 'token_123',
          ci: '4.555.666-7',
        },
        'corr-999'
      );

      expect(loggedLines).toHaveLength(1);
      const parsed = JSON.parse(loggedLines[0]!);
      expect(parsed.level).toBe('info');
      expect(parsed.correlationId).toBe('corr-999');
      expect(parsed.context.targetId).toBe('davia-c11');
      expect(parsed.context.email).toBe('[REDACTED]');
      expect(parsed.context.password).toBe('[REDACTED]');
      expect(parsed.context.authToken).toBe('[REDACTED]');
      expect(parsed.context.ci).toBe('[REDACTED]');
    });
  });
});
