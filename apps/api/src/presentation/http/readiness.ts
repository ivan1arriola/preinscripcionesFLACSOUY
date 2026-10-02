import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';

export interface ReadinessOptions {
  checkDatabase?: () => Promise<boolean>;
  uploadsDir?: string;
}

export function createReadinessHandler(options: ReadinessOptions = {}) {
  const startTime = Date.now();

  return async (_req: Request, res: Response): Promise<void> => {
    const checks: Record<string, 'up' | 'down'> = {
      process: 'up',
      database: 'up',
      storage: 'up',
    };

    // 1. Database check
    if (options.checkDatabase) {
      try {
        const isUp = await options.checkDatabase();
        checks.database = isUp ? 'up' : 'down';
      } catch {
        checks.database = 'down';
      }
    }

    // 2. Storage check
    if (options.uploadsDir) {
      try {
        await fs.mkdir(options.uploadsDir, { recursive: true });
        const testFile = path.join(options.uploadsDir, `.health_${Date.now()}`);
        await fs.writeFile(testFile, 'ok');
        await fs.unlink(testFile);
        checks.storage = 'up';
      } catch {
        checks.storage = 'down';
      }
    }

    const isReady = Object.values(checks).every((val) => val === 'up');
    const statusCode = isReady ? 200 : 503;

    res.status(statusCode).json({
      status: isReady ? 'ready' : 'not_ready',
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks,
    });
  };
}
