import { describe, expect, it } from 'vitest';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemporaryFileStorage } from './temporary-file-storage.js';

async function setup(ttlMs = 30 * 60 * 1000) {
  const root = await mkdtemp(join(tmpdir(), 'flacso-adopt-'));
  const storage = new TemporaryFileStorage({
    rootDir: root,
    maxBytes: 1024,
    allowedMimeTypes: ['application/pdf'],
    ttlMs,
  });
  return { root, storage };
}

function pdf(content = 'pdf-bytes') {
  return { originalName: 'doc.pdf', mimeType: 'application/pdf', data: Buffer.from(content) };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('TemporaryFileStorage.adoptFiles', () => {
  it('adopta archivos pendientes presentes en disco y los mueve a retained/', async () => {
    const { root, storage } = await setup();
    const file = await storage.save('session-legacy', 'cv', pdf('archivo heredado'));

    const missing = await storage.adoptFiles([file.token]);

    expect(missing).toEqual([]);
    expect(await exists(join(root, file.token))).toBe(false);
    expect(await exists(join(root, 'retained', file.token))).toBe(true);
    expect((await storage.open(file.token)).data.toString()).toBe('archivo heredado');
  });

  it('cuenta archivos ya retenidos como éxito sin duplicar ni fallar', async () => {
    const { root, storage } = await setup();
    const file = await storage.save('session-legacy', 'cv', pdf('ya fijado'));
    await storage.pinFiles([file.token], 'session-legacy', 'client-sub-1');

    const missing = await storage.adoptFiles([file.token]);

    expect(missing).toEqual([]);
    expect(await exists(join(root, 'retained', file.token))).toBe(true);
  });

  it('devuelve en la lista de faltantes los tokens que no existen en ningún sitio', async () => {
    const { storage } = await setup();
    const absentToken = '0123456789abcdef0123456789abcdef';

    const missing = await storage.adoptFiles([absentToken]);

    expect(missing).toContain(absentToken);
  });

  it('adopta archivos cuyo TTL ya venció si aún permanecen en el directorio pendiente', async () => {
    // TTL de 0 ms para que nazca vencido
    const { root, storage } = await setup(0);
    const file = await storage.save('session-legacy', 'cv', pdf('vencido pero presente'));

    const missing = await storage.adoptFiles([file.token]);

    expect(missing).toEqual([]);
    expect(await exists(join(root, 'retained', file.token))).toBe(true);
    expect(await exists(join(root, file.token))).toBe(false);
  });

  it('es idempotente: invocarlo múltiples veces sobre los mismos tokens produce el mismo resultado', async () => {
    const { root, storage } = await setup();
    const file = await storage.save('session-legacy', 'cv', pdf('idempotente'));
    const absentToken = 'abcdef0123456789abcdef0123456789';

    const firstResult = await storage.adoptFiles([file.token, absentToken]);
    expect(firstResult).toEqual([absentToken]);

    const secondResult = await storage.adoptFiles([file.token, absentToken]);
    expect(secondResult).toEqual([absentToken]);

    expect(await exists(join(root, 'retained', file.token))).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('carrera adopción vs limpieza: gana exactamente uno, nunca ambos', async () => {
    for (let i = 0; i < 25; i++) {
      const { root, storage } = await setup(0);
      const file = await storage.save('session-carrera', 'cv', pdf());

      const [adopt] = await Promise.allSettled([
        storage.adoptFiles([file.token]),
        storage.cleanup(Date.now() + 60_000),
      ]);

      const inRetained = await exists(join(root, 'retained', file.token));
      if (adopt.status === 'fulfilled') {
        if (adopt.value.includes(file.token)) {
          // La limpieza ganó: el archivo fue reclamado y eliminado, adopción reporta faltante
          expect(inRetained).toBe(false);
        } else {
          // La adopción ganó: el archivo fue movido a retained/
          expect(inRetained).toBe(true);
        }
      }
    }
  });
});
