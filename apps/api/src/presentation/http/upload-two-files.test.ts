import { describe, expect, it } from 'vitest';
import express from 'express';
import { randomBytes } from 'node:crypto';
import type { AcademicTarget } from '@flacso/contracts';
import { createUploadRoutes } from './upload-routes.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { TemporaryFileRecord, TemporaryFileStoragePort } from '../../ports/file-storage.js';

const MiB = 1024 * 1024;
const pdfBytes = (size = 16) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(Math.floor(size))]);
const pngBytes = (size = 16) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(Math.floor(size))]);

const maestria: AcademicTarget = {
  id: 'maestria-1', kind: 'academic_offer', offerType: 'maestria', title: 'Maestría',
  registrationOpen: true, configRevision: 'rev-1', orientations: [], mentions: [],
};
const catalog: AcademicCatalog = {
  listTargets: async () => [maestria], getTarget: async () => maestria,
  revalidateTarget: async () => maestria, revalidateTargets: async () => [maestria],
};

/**
 * Almacenamiento en memoria: estos tests suben hasta ~60 MiB y la lógica de límites solo necesita `save` y
 * `listBySession`. Escribir a disco cargaba a los tests de concurrencia del almacenamiento real.
 */
function memoryStorage(): TemporaryFileStoragePort {
  const records: TemporaryFileRecord[] = [];
  return {
    save: async (sessionId, fieldKey, upload) => {
      const record: TemporaryFileRecord = {
        token: randomBytes(16).toString('hex'), sessionId, fieldKey,
        originalName: upload.originalName, mimeType: upload.mimeType, size: upload.data.byteLength, createdAt: new Date(),
      };
      records.push(record);
      return record;
    },
    open: async () => { throw new Error('unused'); },
    remove: async () => undefined,
    cleanup: async () => 0,
    listBySession: async (sessionId) => records.filter((record) => record.sessionId === sessionId),
  };
}

async function setup() {
  const storage = memoryStorage();
  const app = express();
  app.use(express.json());
  app.use('/api/uploads', createUploadRoutes(storage, catalog));
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  const url = `http://127.0.0.1:${address.port}/api/uploads`;

  const upload = async (fieldKey: string, bytes: Buffer, type: string, name: string, session = 'session-a') => {
    const form = new FormData();
    form.append('targetId', maestria.id);
    form.append('fieldKey', fieldKey);
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    const response = await fetch(url, { method: 'POST', headers: { 'x-preinscription-session': session }, body: form });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  };
  return { upload, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const FIELDS = ['identidad', 'cv', 'titulo', 'cartaMotivacion', 'cartaRecomendacion1', 'cartaRecomendacion2'];

describe('Hasta 2 archivos por campo, PDF o imagen y combinables', () => {
  for (const field of FIELDS) {
    it(`${field}: acepta un PDF y una imagen en el mismo campo y rechaza el tercero`, async () => {
      const { upload, close } = await setup();
      try {
        expect((await upload(field, pdfBytes(), 'application/pdf', 'uno.pdf')).status).toBe(201);
        expect((await upload(field, pngBytes(), 'image/png', 'dos.png')).status).toBe(201);
        const third = await upload(field, pdfBytes(), 'application/pdf', 'tres.pdf');
        expect(third.status).toBe(400);
        expect(third.json.error.code).toBe('MAX_FILES_EXCEEDED');
      } finally {
        await close();
      }
    });
  }

  it('admite dos imágenes o dos PDF en el mismo campo', async () => {
    const { upload, close } = await setup();
    try {
      expect((await upload('titulo', pngBytes(), 'image/png', 'frente.png')).status).toBe(201);
      expect((await upload('titulo', pngBytes(), 'image/png', 'dorso.png')).status).toBe(201);
      expect((await upload('cv', pdfBytes(), 'application/pdf', 'a.pdf')).status).toBe(201);
      expect((await upload('cv', pdfBytes(), 'application/pdf', 'b.pdf')).status).toBe(201);
    } finally {
      await close();
    }
  });

  it('el tope total alcanza para 12 archivos de tamaño normal (hasta 60 MiB)', async () => {
    const { upload, close } = await setup();
    try {
      // 12 escaneos de 4,5 MiB = 54 MiB. Con el tope anterior (25 MiB) fallaba a partir del sexto.
      for (const field of FIELDS) {
        expect((await upload(field, pdfBytes(4.5 * MiB), 'application/pdf', `${field}-1.pdf`)).status).toBe(201);
        expect((await upload(field, pdfBytes(4.5 * MiB), 'application/pdf', `${field}-2.pdf`)).status).toBe(201);
      }
    } finally {
      await close();
    }
  }, 60_000);

  it('rechaza lo que pasa de 60 MiB y el mensaje dice el tope vigente', async () => {
    const { upload, close } = await setup();
    try {
      for (const field of FIELDS) {
        expect((await upload(field, pdfBytes(9.9 * MiB), 'application/pdf', `${field}.pdf`)).status).toBe(201);
      }
      // 6 x 9,9 MiB = 59,4 MiB: otro archivo de 9,9 MiB supera los 60 MiB.
      const over = await upload('identidad', pdfBytes(9.9 * MiB), 'application/pdf', 'extra.pdf');
      expect(over.status).toBe(400);
      expect(over.json.error.code).toBe('TOTAL_SIZE_EXCEEDED');
      expect(over.json.error.message).toContain('60 MiB');
    } finally {
      await close();
    }
  }, 60_000);
});
