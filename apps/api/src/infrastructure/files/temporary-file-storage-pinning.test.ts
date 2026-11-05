import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemporaryFileStorage } from './temporary-file-storage.js';

const pdf = (data = 'contenido') => ({ originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from(data) });

async function setup(ttlMs = 60_000) {
  const root = await mkdtemp(join(tmpdir(), 'flacso-pin-'));
  const storage = new TemporaryFileStorage({ rootDir: root, maxBytes: 1024, allowedMimeTypes: ['application/pdf'], ttlMs });
  return { root, storage };
}
const exists = (p: string) => stat(p).then(() => true, () => false);

describe('TemporaryFileStorage pinning (P1)', () => {
  it('pins a file into retained/ and keeps it readable by its owner', async () => {
    const { root, storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    await storage.pinFiles([a.token], 's1', 'client-1');
    expect(await exists(join(root, a.token))).toBe(false);
    expect(await exists(join(root, 'retained', a.token))).toBe(true);
    expect((await storage.open(a.token, 's1')).data.toString()).toBe('contenido');
    expect((await storage.open(a.token)).data.toString()).toBe('contenido');
    await expect(storage.open(a.token, 's2')).rejects.toThrow('no autorizado');
  });

  it('pinning is idempotent: a second pin of the same token for the same session succeeds', async () => {
    const { storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    await storage.pinFiles([a.token], 's1', 'client-1');
    await storage.pinFiles([a.token], 's1', 'client-1');
  });

  it('resumes a partial pin: some tokens already retained, the rest are pinned', async () => {
    const { root, storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf('a'));
    const b = await storage.save('s1', 'dni', pdf('b'));
    await storage.pinFiles([a.token], 's1', 'client-1');
    await storage.pinFiles([a.token, b.token], 's1', 'client-1');
    expect(await exists(join(root, 'retained', b.token))).toBe(true);
  });

  it('rejects pinning a token that belongs to another session', async () => {
    const { storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    await expect(storage.pinFiles([a.token], 's2', 'client-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await storage.pinFiles([a.token], 's1', 'client-1');
    await expect(storage.pinFiles([a.token], 's2', 'client-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reports FILE_EXPIRED when the token no longer exists anywhere', async () => {
    const { storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    await storage.removePending(a.token, 's1');
    await expect(storage.pinFiles([a.token], 's1', 'client-1')).rejects.toMatchObject({ code: 'FILE_EXPIRED' });
  });

  it('cleanup never touches retained files and removes expired pending ones', async () => {
    const { root, storage } = await setup(0);
    const pinned = await storage.save('s1', 'cv', pdf('p'));
    const loose = await storage.save('s1', 'dni', pdf('l'));
    await storage.pinFiles([pinned.token], 's1', 'client-1');
    const removed = await storage.cleanup(Date.now() + 60_000);
    expect(removed).toBe(1);
    expect(await exists(join(root, loose.token))).toBe(false);
    expect(await exists(join(root, 'retained', pinned.token))).toBe(true);
    expect(await readdir(join(root, 'deleting'))).toEqual([]);
  });

  // rename(2) de Linux es exclusivo (verificado: 0 de 300 carreras con ambos éxitos). El rename de Windows NO lo es
  // (299 de 300 con ambos éxitos), por eso la garantía de P1 solo se afirma donde corre producción.
  it.skipIf(process.platform === 'win32')('pin and cleanup racing on the same token: exactly one wins, never both', async () => {
    for (let i = 0; i < 25; i++) {
      const { root, storage } = await setup(0);
      const a = await storage.save('s1', 'cv', pdf());
      const [pin] = await Promise.allSettled([
        storage.pinFiles([a.token], 's1', 'client-1'),
        storage.cleanup(Date.now() + 60_000),
      ]);
      const retained = await exists(join(root, 'retained', a.token));
      if (pin.status === 'fulfilled') expect(retained).toBe(true);
      else {
        expect(pin.reason).toMatchObject({ code: 'FILE_EXPIRED' });
        expect(retained).toBe(false);
      }
    }
  });

  it('removePending deletes a pending file but refuses a pinned one (409) leaving it intact', async () => {
    const { root, storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    const b = await storage.save('s1', 'dni', pdf());
    await storage.removePending(a.token, 's1');
    expect(await exists(join(root, a.token))).toBe(false);
    await storage.pinFiles([b.token], 's1', 'client-1');
    await expect(storage.removePending(b.token, 's1')).rejects.toMatchObject({ code: 'FILE_ALREADY_SUBMITTED' });
    expect(await exists(join(root, 'retained', b.token))).toBe(true);
  });

  it('removePending rejects other sessions', async () => {
    const { storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    await expect(storage.removePending(a.token, 's2')).rejects.toThrow('no autorizado');
  });

  it('releaseRetained deletes a pinned file and is idempotent', async () => {
    const { root, storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    await storage.pinFiles([a.token], 's1', 'client-1');
    await storage.releaseRetained(a.token);
    expect(await exists(join(root, 'retained', a.token))).toBe(false);
    await storage.releaseRetained(a.token);
  });

  it('removes orphaned retained files older than the cutoff that nothing references', async () => {
    const { root, storage } = await setup();
    const kept = await storage.save('s1', 'cv', pdf());
    const orphan = await storage.save('s1', 'dni', pdf());
    await storage.pinFiles([kept.token, orphan.token], 's1', 'client-1');
    const removed = await storage.cleanupRetainedOrphans(Date.now() + 8 * 86_400_000, async (t) => t === kept.token);
    expect(removed).toBe(1);
    expect(await exists(join(root, 'retained', orphan.token))).toBe(false);
    expect(await exists(join(root, 'retained', kept.token))).toBe(true);
  });

  it('does not remove retained files younger than the cutoff', async () => {
    const { storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    await storage.pinFiles([a.token], 's1', 'client-1');
    expect(await storage.cleanupRetainedOrphans(Date.now() - 1000, async () => false)).toBe(0);
  });

  it('lists pinned files of a session alongside pending ones', async () => {
    const { storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf());
    const b = await storage.save('s1', 'dni', pdf());
    await storage.pinFiles([a.token], 's1', 'client-1');
    const tokens = (await storage.listBySession('s1')).map((r) => r.token).sort();
    expect(tokens).toEqual([a.token, b.token].sort());
  });
});
