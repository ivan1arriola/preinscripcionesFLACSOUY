import { describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createAsyncRouter } from './async-router.js';
import { errorHandler } from './error-handler.js';

describe('createAsyncRouter', () => {
  async function withServer(run: (baseUrl: string) => Promise<void>) {
    const app = express();
    const router = createAsyncRouter();
    router.get('/falla-async', async () => {
      throw new Error('PostgreSQL no responde');
    });
    router.get('/falla-sync', () => {
      throw new Error('error síncrono');
    });
    router.get('/ok', async (_req, res) => {
      res.json({ ok: true });
    });
    app.use('/api', router);
    app.use(errorHandler);

    let server!: Server;
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      await run(`http://localhost:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('turns a rejected async handler into a 500 instead of crashing or hanging', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/falla-async`);
        expect(response.status).toBe(500);
        expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
      });
      expect(rejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('handles synchronous errors and keeps healthy handlers working', async () => {
    await withServer(async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/falla-sync`)).status).toBe(500);
      const ok = await fetch(`${baseUrl}/api/ok`);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true });
    });
  });
});
