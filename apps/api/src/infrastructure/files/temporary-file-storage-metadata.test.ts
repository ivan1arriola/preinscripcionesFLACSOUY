import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemporaryFileStorage } from './temporary-file-storage.js';
import type { TemporaryUploadRecord, TemporaryUploadRepository } from '../../ports/temporary-upload-repository.js';

const pdf = { originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('contenido') };

function fakeRepository() {
  const records = new Map<string, TemporaryUploadRecord>();
  const calls = { deleteMetadata: [] as string[] };
  const repository: TemporaryUploadRepository = {
    async create(input) {
      const record: TemporaryUploadRecord = {
        ...input, createdAt: new Date(), lastActivityAt: new Date(), expiresAt: input.expiresAt ?? new Date(),
      };
      records.set(input.token, record);
      return record;
    },
    async get(token, sessionId) {
      const r = records.get(token);
      return r && (sessionId === undefined || r.sessionId === sessionId) ? r : null;
    },
    async listBySession(sessionId) { return [...records.values()].filter((r) => r.sessionId === sessionId); },
    async touch() {},
    async remove(token) { return records.delete(token); },
    async listExpired(before) { return [...records.values()].filter((r) => r.expiresAt < before); },
    async deleteMetadata(token) { calls.deleteMetadata.push(token); records.delete(token); },
    async extendExpiry(token, expiresAt) {
      const r = records.get(token);
      if (r) r.expiresAt = expiresAt;
    },
  };
  return { repository, calls, records };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'flacso-meta-'));
  const { repository, calls, records } = fakeRepository();
  const storage = new TemporaryFileStorage({
    rootDir: root, maxBytes: 1024, allowedMimeTypes: ['application/pdf'], ttlMs: 0, repository,
  });
  return { root, storage, calls, records };
}

describe('TemporaryFileStorage metadata integrity', () => {
  it('cleanup never drops the database record of a retained file whose metadata cannot be parsed', async () => {
    const { root, storage, calls, records } = await setup();
    const a = await storage.save('s1', 'cv', pdf);
    await storage.pinFiles([a.token], 's1', 'client-1');
    // Simula la lectura de un metadata.json parcial (escritura en curso): el archivo existe pero no se puede leer.
    await writeFile(join(root, 'retained', a.token, 'metadata.json'), '{"sessionId":"s1","orig');
    // El registro sigue vencido en la base (como en la ventana entre el rename y la extensión del vencimiento).
    records.get(a.token)!.expiresAt = new Date(0);

    await storage.cleanup(Date.now() + 60_000);

    expect(calls.deleteMetadata).not.toContain(a.token);
    expect(records.has(a.token)).toBe(true);
  });

  it('a file that is really gone does lose its stale database record', async () => {
    const { root, storage, calls } = await setup();
    const b = await storage.save('s1', 'dni', pdf);
    await rm(join(root, b.token), { recursive: true, force: true });
    await storage.cleanup(Date.now() + 60_000);
    expect(calls.deleteMetadata).toContain(b.token);
  });

  it('pin reports the real error, not FILE_EXPIRED, when retained metadata is unreadable', async () => {
    const { root, storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf);
    await storage.pinFiles([a.token], 's1', 'client-1');
    await writeFile(join(root, 'retained', a.token, 'metadata.json'), '{"sessionId":');
    await expect(storage.pinFiles([a.token], 's1', 'client-1')).rejects.not.toMatchObject({ code: 'FILE_EXPIRED' });
  });

  it('writes metadata atomically: no temporary files are left behind', async () => {
    const { root, storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf);
    await storage.pinFiles([a.token], 's1', 'client-1');
    await storage.extendRetention(a.token, new Date(Date.now() + 1000));
    expect((await readdir(join(root, 'retained', a.token))).sort()).toEqual(['metadata.json', 'payload']);
  });

  it('concurrent readers never observe partially written metadata while it is rewritten', async () => {
    const { root, storage } = await setup();
    const a = await storage.save('s1', 'cv', pdf);
    await storage.pinFiles([a.token], 's1', 'client-1');
    let stop = false;
    const readers = (async () => {
      let bad = 0;
      while (!stop) {
        try {
          await storage.open(a.token, 's1');
        } catch (error) {
          bad++;
          void error;
        }
      }
      return bad;
    })();
    for (let i = 0; i < 100; i++) await storage.extendRetention(a.token, new Date(Date.now() + 1000 + i));
    stop = true;
    expect(await readers).toBe(0);
    void root;
  });
});
