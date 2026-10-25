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
    // POSIX mode bits are not reported consistently by Windows filesystems.
    if (process.platform !== 'win32') expect(fileInfo.mode & 0o077).toBe(0);
  });

  it('opens a file without a session for administrative recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-'));
    const storage = new TemporaryFileStorage({ rootDir: root, maxBytes: 1024, allowedMimeTypes: ['application/pdf'], ttlMs: 60_000 });

    const saved = await storage.save('session-a', 'cv', {
      originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('contenido'),
    });

    // El reintento administrativo no conoce la sesión del postulante.
    expect((await storage.open(saved.token)).data.toString()).toBe('contenido');
    await expect(storage.open(saved.token, 'session-b')).rejects.toThrow('no autorizado');
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

  it('retains files attached to a failed submission for 7 days while abandoned uploads expire normally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-'));
    const storage = new TemporaryFileStorage({
      rootDir: root,
      maxBytes: 1024,
      allowedMimeTypes: ['application/pdf'],
      ttlMs: 30 * 60 * 1000, // 30 mins
    });

    // 1. Upload abandoned file
    const abandoned = await storage.save('session-abandoned', 'cv', {
      originalName: 'abandoned.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('abandoned'),
    });

    // 2. Upload file for failed submission
    const failedSubmissionFile = await storage.save('session-failed', 'cv', {
      originalName: 'failed.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('failed-submission-cv'),
    });

    // 3. Failed submission extends retention to 7 days
    const now = Date.now();
    const sevenDaysLater = new Date(now + 7 * 24 * 60 * 60 * 1000);
    await storage.extendRetention(failedSubmissionFile.token, sevenDaysLater);

    // 4. After 1 hour (abandoned form expired at 30 min, but failed file still within 7 days)
    const oneHourLater = now + 60 * 60 * 1000;
    const cleaned = await storage.cleanup(oneHourLater);
    expect(cleaned).toBe(1);

    // Abandoned payload should be gone
    await expect(readFile(join(root, abandoned.token, 'payload'))).rejects.toThrow();

    // Failed submission payload should still exist!
    const retainedContent = await readFile(join(root, failedSubmissionFile.token, 'payload'));
    expect(retainedContent.toString()).toBe('failed-submission-cv');

    // 5. After 8 days (now failed submission is also expired)
    const eightDaysLater = now + 8 * 24 * 60 * 60 * 1000;
    const secondCleaned = await storage.cleanup(eightDaysLater);
    expect(secondCleaned).toBe(1);
    await expect(readFile(join(root, failedSubmissionFile.token, 'payload'))).rejects.toThrow();
  });
});
