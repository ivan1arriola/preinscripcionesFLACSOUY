import { describe, expect, it } from 'vitest';
import express from 'express';
import { createUploadRoutes } from './upload-routes.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';

function setup(options: { touch?: TemporaryFileStoragePort['touch'] | null } = {}) {
  const touched: string[] = [];
  const storage: TemporaryFileStoragePort = {
    save: async () => { throw new Error('unused'); },
    open: async () => { throw new Error('unused'); },
    remove: async () => undefined,
    cleanup: async () => 0,
    ...(options.touch === null ? {} : { touch: options.touch ?? (async (sessionId: string) => { touched.push(sessionId); }) }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/uploads', createUploadRoutes(storage));
  return { app, touched };
}

async function request(app: express.Express, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/uploads/keepalive`, { method: 'POST', headers });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('POST /api/uploads/keepalive', () => {
  it('renueva los archivos de la sesión mientras la persona sigue completando el formulario', async () => {
    const { app, touched } = setup();
    const res = await request(app, { 'x-preinscription-session': 'session-a' });
    expect(res.status).toBe(200);
    expect(touched).toEqual(['session-a']);
  });

  it('exige la sesión y no renueva nada sin ella', async () => {
    const { app, touched } = setup();
    const res = await request(app);
    expect(res.status).toBe(400);
    expect(touched).toEqual([]);
  });

  it('responde bien aunque el almacenamiento no tenga renovación (modo sin base)', async () => {
    const { app } = setup({ touch: null });
    expect((await request(app, { 'x-preinscription-session': 'session-a' })).status).toBe(200);
  });

  it('no deja caer la petición si la renovación falla: el formulario la reintenta en el próximo ciclo', async () => {
    const { app } = setup({ touch: async () => { throw new Error('db caída'); } });
    const res = await request(app, { 'x-preinscription-session': 'session-a' });
    expect(res.status).toBe(503);
  });
});
