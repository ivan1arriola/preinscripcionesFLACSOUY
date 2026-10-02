import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';

describe('Target HTTP Routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const catalog = new FixtureAcademicCatalog();
    const repository = new InMemorySubmissionRepository();
    const app = createApp({ catalog, repository });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /api/targets returns list of discovered targets with diagnostics', async () => {
    const res = await fetch(`${baseUrl}/api/targets`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.targets).toBeDefined();
    expect(Array.isArray(data.targets)).toBe(true);
    expect(data.targets.length).toBeGreaterThanOrEqual(4);

    const davia = data.targets.find((t: any) => t.id === 'davia-c11');
    expect(davia.status).toBe('operational');
  });

  it('GET /api/targets/:id returns FormDefinition for valid open target', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11`);
    expect(res.status).toBe(200);

    const form = await res.json();
    expect(form.targetId).toBe('davia-c11');
    expect(form.configRevision).toBe('davia-c11-v1');
    expect(form.inputs).toBeDefined();
    expect(form.orientations).toBeDefined();
  });

  it('GET /api/targets/:id returns 404 for unknown target', async () => {
    const res = await fetch(`${baseUrl}/api/targets/target-no-existe`);
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/targets/:id returns 409 for incompatible target', async () => {
    const res = await fetch(`${baseUrl}/api/targets/oferta-incompatible`);
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error.code).toBe('INCOMPATIBLE_FORM');
    expect(data.error.issues).toBeDefined();
  });
});
