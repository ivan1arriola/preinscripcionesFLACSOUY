import { describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { RateLimiter } from './rate-limit.js';
import { createApp, resolveTrustProxyHops } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';

describe('RateLimiter', () => {
  it('allows up to max events per window and then reports when to retry', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ windowMs: 60_000, max: 2, now: () => now });

    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    const blocked = limiter.hit('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // Otra clave no se ve afectada.
    expect(limiter.hit('b').allowed).toBe(true);

    now += 60_001;
    expect(limiter.hit('a').allowed).toBe(true);
  });

  it('peek does not consume quota', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 1 });
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.peek('a').allowed).toBe(true);
    limiter.hit('a');
    expect(limiter.peek('a').allowed).toBe(false);
  });
});

describe('resolveTrustProxyHops', () => {
  const original = { hops: process.env.TRUST_PROXY_HOPS, env: process.env.NODE_ENV };
  const restore = () => {
    if (original.hops === undefined) delete process.env.TRUST_PROXY_HOPS; else process.env.TRUST_PROXY_HOPS = original.hops;
    process.env.NODE_ENV = original.env;
  };

  it('trusts the two production proxies (Apache and nginx) by default', () => {
    try {
      delete process.env.TRUST_PROXY_HOPS;
      process.env.NODE_ENV = 'production';
      expect(resolveTrustProxyHops()).toBe(2);
      process.env.NODE_ENV = 'test';
      expect(resolveTrustProxyHops()).toBe(0);
      process.env.TRUST_PROXY_HOPS = '1';
      expect(resolveTrustProxyHops()).toBe(1);
    } finally {
      restore();
    }
  });
});

describe('HTTP rate limits', () => {
  async function withApp(
    options: Parameters<typeof createApp>[0]['rateLimits'],
    run: (baseUrl: string) => Promise<void>,
    trustProxyHops?: number,
  ) {
    const app = createApp({
      catalog: new FixtureAcademicCatalog(),
      repository: new InMemorySubmissionRepository(),
      rateLimits: options,
      trustProxyHops,
    });
    let server!: Server;
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    try {
      const address = server.address();
      await run(`http://localhost:${typeof address === 'object' && address ? address.port : 0}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  const post = (baseUrl: string, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    });

  it('answers 429 with Retry-After once an IP exceeds the submission limit', async () => {
    await withApp({ submissions: { windowMs: 60_000, max: 2 } }, async (baseUrl) => {
      expect((await post(baseUrl)).status).toBe(400);
      expect((await post(baseUrl)).status).toBe(400);
      const limited = await post(baseUrl);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
      expect((await limited.json()).error.code).toBe('RATE_LIMITED');
    });
  });

  it('also rate limits the start of a resumable upload (not only POST /api/uploads)', async () => {
    await withApp({ uploads: { windowMs: 60_000, max: 1 } }, async (baseUrl) => {
      const start = () => fetch(`${baseUrl}/api/uploads/resumable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect((await start()).status).not.toBe(429);
      expect((await start()).status).toBe(429);
    });
  });

  it('can be disabled', async () => {
    await withApp(false, async (baseUrl) => {
      for (let i = 0; i < 5; i += 1) expect((await post(baseUrl)).status).toBe(400);
    });
  });

  it('limits each visitor separately when the proxies forward X-Forwarded-For', async () => {
    await withApp({ submissions: { windowMs: 60_000, max: 1 } }, async (baseUrl) => {
      // Dos visitantes distintos detrás de los mismos proxies: cada uno tiene su propio cupo.
      expect((await post(baseUrl, { 'X-Forwarded-For': '203.0.113.10' })).status).toBe(400);
      expect((await post(baseUrl, { 'X-Forwarded-For': '203.0.113.11' })).status).toBe(400);
      expect((await post(baseUrl, { 'X-Forwarded-For': '203.0.113.10' })).status).toBe(429);
    }, 1);
  });

  it('without trusting the proxy header a client cannot dodge the limit by spoofing it', async () => {
    await withApp({ submissions: { windowMs: 60_000, max: 1 } }, async (baseUrl) => {
      expect((await post(baseUrl, { 'X-Forwarded-For': '203.0.113.10' })).status).toBe(400);
      expect((await post(baseUrl, { 'X-Forwarded-For': '203.0.113.99' })).status).toBe(429);
    }, 0);
  });
});
