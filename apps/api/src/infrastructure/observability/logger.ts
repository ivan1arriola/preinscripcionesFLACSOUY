import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { sanitizeErrorContext } from '../../domain/system-error.js';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

export class StructuredLogger {
  private outputStream: (line: string) => void;

  constructor(outputStream: (line: string) => void = (line) => console.log(line)) {
    this.outputStream = outputStream;
  }

  log(
    level: LogEntry['level'],
    message: string,
    context?: Record<string, unknown>,
    correlationId?: string
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId,
      context: context ? sanitizeErrorContext(context) : undefined,
    };

    this.outputStream(JSON.stringify(entry));
  }

  info(message: string, context?: Record<string, unknown>, correlationId?: string): void {
    this.log('info', message, context, correlationId);
  }

  warn(message: string, context?: Record<string, unknown>, correlationId?: string): void {
    this.log('warn', message, context, correlationId);
  }

  error(message: string, context?: Record<string, unknown>, correlationId?: string): void {
    this.log('error', message, context, correlationId);
  }

  debug(message: string, context?: Record<string, unknown>, correlationId?: string): void {
    if (process.env.DEBUG || process.env.NODE_ENV !== 'production') {
      this.log('debug', message, context, correlationId);
    }
  }
}

export const logger = new StructuredLogger();

export function createCorrelationIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const headerId = req.headers['x-correlation-id'];
    const correlationId =
      typeof headerId === 'string' && headerId.trim().length > 0
        ? headerId.trim()
        : `req_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

    (req as any).correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    next();
  };
}

export function createRequestLoggingMiddleware(customLogger: StructuredLogger = logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = performance.now();
    const correlationId = (req as any).correlationId;

    res.on('finish', () => {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      customLogger.log(
        level,
        `${req.method} ${req.originalUrl || req.url} ${res.statusCode} in ${durationMs}ms`,
        {
          method: req.method,
          url: req.originalUrl || req.url,
          statusCode: res.statusCode,
          durationMs,
          ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress,
        },
        correlationId
      );
    });

    next();
  };
}
