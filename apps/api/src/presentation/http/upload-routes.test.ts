import { describe, expect, it } from 'vitest';
import express from 'express';
import { createUploadRoutes } from './upload-routes.js';
import { TemporaryFileStorage } from '../../infrastructure/files/temporary-file-storage.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Upload HTTP Routes', () => {
  it('stores a selected file immediately and returns a private token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-route-'));
    const storage = new TemporaryFileStorage({ rootDir: root, maxBytes: 1024, allowedMimeTypes: ['application/pdf'] });
    const app = express();
    app.use('/api/uploads', createUploadRoutes(storage));
    const form = new FormData();
    form.append('targetId', 'target-1');
    form.append('fieldKey', 'cv');
    form.append('file', new Blob([Buffer.from('pdf')], { type: 'application/pdf' }), 'cv.pdf');

    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/uploads`, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-a' },
        body: form,
      });
      expect(response.status).toBe(201);
      const payload = await response.json() as { token: string; fieldKey: string };
      expect(payload.token).toMatch(/^[a-f0-9]{32}$/);
      expect(payload.fieldKey).toBe('cv');
      await expect(storage.open(payload.token, 'session-a')).resolves.toMatchObject({ originalName: 'cv.pdf' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
