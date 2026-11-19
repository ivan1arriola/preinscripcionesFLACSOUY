import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemporaryFileStorage } from './temporary-file-storage.js';

describe('TemporaryFileStorage', () => {
  it('continues a partial upload only from its confirmed offset and finalizes it as a normal file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-'));
    const storage = new TemporaryFileStorage({ rootDir: root, maxBytes: 1024, allowedMimeTypes: ['application/pdf'] });

    const partial = await storage.beginResumable('session-a', 'cv', {
      originalName: 'cv.pdf', mimeType: 'application/pdf', size: 12,
    });
    expect(await storage.getResumableOffset(partial.uploadId, 'session-a')).toBe(0);
    await storage.appendResumable(partial.uploadId, 'session-a', 0, Buffer.from('%PDF-'));
    expect(await storage.getResumableOffset(partial.uploadId, 'session-a')).toBe(5);
    await expect(storage.appendResumable(partial.uploadId, 'session-a', 0, Buffer.from('duplicado'))).rejects.toThrow(/offset/i);
    await storage.appendResumable(partial.uploadId, 'session-a', 5, Buffer.from('datos!!'));

    const saved = await storage.finishResumable(partial.uploadId, 'session-a');
    expect((await storage.open(saved.token, 'session-a')).data.toString()).toBe('%PDF-datos!!');

    const abandoned = await storage.beginResumable('session-a', 'cv', { originalName: 'otro.pdf', mimeType: 'application/pdf', size: 10 });
    await storage.cleanup(Date.now() + 60 * 60 * 1000);
    await expect(storage.getResumableOffset(abandoned.uploadId, 'session-a')).rejects.toThrow();
  });
  it('does not duplicate bytes when two PATCHes arrive at the same offset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-'));
    const storage = new TemporaryFileStorage({ rootDir: root, maxBytes: 1024, allowedMimeTypes: ['application/pdf'] });
    const { uploadId } = await storage.beginResumable('session-a', 'cv', { originalName: 'cv.pdf', mimeType: 'application/pdf', size: 10 });
    const chunk = Buffer.from('%PDF-datos');

    // El segundo puede fallar por offset si llega tarde; lo que importa es que el payload quede con el fragmento una sola vez.
    await Promise.allSettled([
      storage.appendResumable(uploadId, 'session-a', 0, chunk),
      storage.appendResumable(uploadId, 'session-a', 0, chunk),
    ]);

    expect(await readFile(join(root, 'resumable', uploadId, 'payload'))).toEqual(chunk);
  });

  it('cleans every stale resumable upload even when one has unreadable metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-'));
    const storage = new TemporaryFileStorage({ rootDir: root, maxBytes: 1024, allowedMimeTypes: ['application/pdf'] });
    const corrupt = 'a'.repeat(32);
    await mkdir(join(root, 'resumable', corrupt), { recursive: true });
    await writeFile(join(root, 'resumable', corrupt, 'metadata.json'), '{no es json');
    const { uploadId } = await storage.beginResumable('session-a', 'cv', { originalName: 'cv.pdf', mimeType: 'application/pdf', size: 10 });

    await storage.cleanup(Date.now() + 60 * 60 * 1000);

    await expect(stat(join(root, 'resumable', corrupt))).rejects.toThrow();
    await expect(stat(join(root, 'resumable', uploadId))).rejects.toThrow();
  });

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
