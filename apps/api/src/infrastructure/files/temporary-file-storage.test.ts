import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemporaryFileStorage } from './temporary-file-storage.js';

describe('TemporaryFileStorage', () => {
  it('stores a private file and opens it only for its owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-'));
    const storage = new TemporaryFileStorage({ rootDir: root, maxBytes: 1024, allowedMimeTypes: ['application/pdf'], ttlMs: 0 });

    const saved = await storage.save('session-a', 'cv', {
      originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('contenido'),
    });

    expect(saved.token).toMatch(/^[a-f0-9]{32}$/);
    expect((await storage.open(saved.token, 'session-a')).data.toString()).toBe('contenido');
    await expect(storage.open(saved.token, 'session-b')).rejects.toThrow('no autorizado');
    const fileInfo = await stat(join(root, saved.token, 'payload'));
    expect(fileInfo.mode & 0o077).toBe(0);
  });

  it('rejects disallowed type or size and removes expired files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-'));
    const storage = new TemporaryFileStorage({ rootDir: root, maxBytes: 4, allowedMimeTypes: ['application/pdf'], ttlMs: 0 });
    await expect(storage.save('session-a', 'cv', { originalName: 'cv.txt', mimeType: 'text/plain', data: Buffer.from('ok') })).rejects.toThrow('tipo');
    await expect(storage.save('session-a', 'cv', { originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('too long') })).rejects.toThrow('tamaño');

    const saved = await storage.save('session-a', 'cv', { originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('ok') });
    await storage.cleanup(Date.now() + 60_000);
    await expect(readFile(join(root, saved.token, 'payload'))).rejects.toThrow();
  });
});
