import { describe, expect, it } from 'vitest';
import express from 'express';
import { createUploadRoutes } from './upload-routes.js';
import { TemporaryFileStorage } from '../../infrastructure/files/temporary-file-storage.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { AcademicTarget } from '@flacso/contracts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// El servidor verifica la firma real del archivo, no sólo el tipo declarado.
const pdfBytes = (text: string) => Buffer.from(`%PDF-1.4
${text}`);
const pngBytes = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('datos')]);

describe('Upload HTTP Routes', () => {
  const openDiploma: AcademicTarget = {
    id: 'diploma-davia',
    kind: 'academic_offer',
    offerType: 'diploma',
    title: 'Diploma DAVIA',
    registrationOpen: true,
    configRevision: 'rev-1',
    orientations: [],
    mentions: [],
  };

  const openSeminar: AcademicTarget = {
    id: 'seminar-ia',
    kind: 'seminar',
    title: 'Seminario IA',
    registrationOpen: true,
    configRevision: 'rev-sem',
    orientations: [],
    mentions: [],
  };

  const closedTarget: AcademicTarget = {
    id: 'target-closed',
    kind: 'academic_offer',
    offerType: 'diploma',
    title: 'Diploma Cerrado',
    registrationOpen: false,
    configRevision: 'rev-closed',
    orientations: [],
    mentions: [],
  };

  const mockCatalog: AcademicCatalog = {
    listTargets: async () => [openDiploma, openSeminar, closedTarget],
    getTarget: async (id) => {
      if (id === 'diploma-davia') return openDiploma;
      if (id === 'seminar-ia') return openSeminar;
      if (id === 'target-closed') return closedTarget;
      return null;
    },
    revalidateTarget: async (id) => {
      if (id === 'diploma-davia') return openDiploma;
      if (id === 'seminar-ia') return openSeminar;
      if (id === 'target-closed') return closedTarget;
      return null;
    },
    revalidateTargets: async () => [openDiploma, openSeminar, closedTarget],
  };

  async function setupApp(storageOptions?: { maxBytes?: number; maxTotalBytes?: number }) {
    const root = await mkdtemp(join(tmpdir(), 'flacso-upload-test-'));
    const storage = new TemporaryFileStorage({
      rootDir: root,
      maxBytes: storageOptions?.maxBytes ?? 10 * 1024 * 1024,
      allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    });
    const app = express();
    app.use(express.json());
    app.use('/api/uploads', createUploadRoutes(storage, mockCatalog));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    const baseUrl = `http://127.0.0.1:${address.port}/api/uploads`;
    return {
      storage,
      baseUrl,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('stores a valid file immediately and returns a private token', async () => {
    const { baseUrl, storage, close } = await setupApp();
    try {
      const form = new FormData();
      form.append('targetId', 'diploma-davia');
      form.append('fieldKey', 'cv');
      form.append('file', new Blob([pdfBytes('pdf data')], { type: 'application/pdf' }), 'curriculum.pdf');

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-alpha' },
        body: form,
      });

      expect(response.status).toBe(201);
      const payload = (await response.json()) as { token: string; fieldKey: string; originalName: string };
      expect(payload.token).toMatch(/^[a-f0-9]{32}$/);
      expect(payload.fieldKey).toBe('cv');
      expect(payload.originalName).toBe('curriculum.pdf');
      await expect(storage.open(payload.token, 'session-alpha')).resolves.toMatchObject({
        originalName: 'curriculum.pdf',
      });
    } finally {
      await close();
    }
  });

  it('rejects a file whose content does not match the declared type', async () => {
    const { baseUrl, close } = await setupApp();
    try {
      const form = new FormData();
      form.append('targetId', 'diploma-davia');
      form.append('fieldKey', 'cv');
      // Un ejecutable de Windows declarado como PDF.
      form.append('file', new Blob([Buffer.from('MZ\x90\x00 programa.exe')], { type: 'application/pdf' }), 'cv.pdf');

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-alpha' },
        body: form,
      });

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('INVALID_FILE_CONTENT');
    } finally {
      await close();
    }
  });

  it('rejects an upload that omits the target, which would skip the field rules', async () => {
    const { baseUrl, close } = await setupApp();
    try {
      const form = new FormData();
      form.append('fieldKey', 'cv');
      form.append('file', new Blob([pdfBytes('pdf')], { type: 'application/pdf' }), 'cv.pdf');

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-alpha' },
        body: form,
      });

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('INVALID_REQUEST');
    } finally {
      await close();
    }
  });

  it('rejects upload when session header is missing', async () => {
    const { baseUrl, close } = await setupApp();
    try {
      const form = new FormData();
      form.append('targetId', 'diploma-davia');
      form.append('fieldKey', 'cv');
      form.append('file', new Blob([pdfBytes('pdf')], { type: 'application/pdf' }), 'cv.pdf');

      const response = await fetch(baseUrl, {
        method: 'POST',
        body: form,
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toMatch(/sesión.*obligatoria/i);
    } finally {
      await close();
    }
  });

  it('rejects upload for closed target or non-existent target', async () => {
    const { baseUrl, close } = await setupApp();
    try {
      // Closed target
      const formClosed = new FormData();
      formClosed.append('targetId', 'target-closed');
      formClosed.append('fieldKey', 'cv');
      formClosed.append('file', new Blob([pdfBytes('pdf')], { type: 'application/pdf' }), 'cv.pdf');

      const resClosed = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-alpha' },
        body: formClosed,
      });
      expect(resClosed.status).toBe(400);

      // Unknown target
      const formUnknown = new FormData();
      formUnknown.append('targetId', 'unknown-target');
      formUnknown.append('fieldKey', 'cv');
      formUnknown.append('file', new Blob([pdfBytes('pdf')], { type: 'application/pdf' }), 'cv.pdf');

      const resUnknown = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-alpha' },
        body: formUnknown,
      });
      expect(resUnknown.status).toBe(404);
    } finally {
      await close();
    }
  });

  it('rejects unsupported field for target (e.g. motivation or recommendations on seminar)', async () => {
    const { baseUrl, close } = await setupApp();
    try {
      const form = new FormData();
      form.append('targetId', 'seminar-ia');
      form.append('fieldKey', 'cartaMotivacion'); // Seminars do not accept motivation letter
      form.append('file', new Blob([pdfBytes('pdf')], { type: 'application/pdf' }), 'carta.pdf');

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-alpha' },
        body: form,
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toMatch(/no corresponde/i);
    } finally {
      await close();
    }
  });

  it('accepts an image (photo or scan) in a field that used to accept only PDF, such as the CV', async () => {
    const { baseUrl, close } = await setupApp();
    try {
      const form = new FormData();
      form.append('targetId', 'diploma-davia');
      form.append('fieldKey', 'cv');
      form.append('file', new Blob([pngBytes()], { type: 'image/png' }), 'cv.png');

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-alpha' },
        body: form,
      });

      expect(response.status).toBe(201);
    } finally {
      await close();
    }
  });

  it('accepts PNG and WhatsApp images with a generic content type after checking their signatures', async () => {
    const { baseUrl, storage, close } = await setupApp();
    try {
      for (const [name, bytes, expected] of [
        ['foto.png', pngBytes(), 'image/png'],
        ['foto.wspimage', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'],
      ] as const) {
        const form = new FormData();
        form.append('targetId', 'diploma-davia');
        form.append('fieldKey', 'identidad');
        form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), name);
        const response = await fetch(baseUrl, { method: 'POST', headers: { 'x-preinscription-session': 'generic-images' }, body: form });
        expect(response.status).toBe(201);
        const result = await response.json() as { token: string; mimeType: string };
        expect(result.mimeType).toBe(expected);
        expect((await storage.open(result.token, 'generic-images')).mimeType).toBe(expected);
      }
    } finally {
      await close();
    }
  });

  it('rejects an unaccepted MIME type for any field (e.g. GIF)', async () => {
    const { baseUrl, close } = await setupApp();
    try {
      const form = new FormData();
      form.append('targetId', 'diploma-davia');
      form.append('fieldKey', 'cv');
      form.append('file', new Blob([Buffer.from('GIF89a')], { type: 'image/gif' }), 'cv.gif');

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-alpha' },
        body: form,
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toMatch(/no permitido|no coincide/i);
    } finally {
      await close();
    }
  });

  it('rejects file exceeding max files per requirement (e.g. third CV, since each field admits up to 2)', async () => {
    const { baseUrl, close } = await setupApp();
    try {
      const upload = async (name: string) => {
        const form = new FormData();
        form.append('targetId', 'diploma-davia');
        form.append('fieldKey', 'cv');
        form.append('file', new Blob([pdfBytes(name)], { type: 'application/pdf' }), `${name}.pdf`);
        return fetch(baseUrl, { method: 'POST', headers: { 'x-preinscription-session': 'session-beta' }, body: form });
      };

      expect((await upload('cv 1')).status).toBe(201);
      expect((await upload('cv 2')).status).toBe(201);

      // 3rd CV upload for the same session: fails
      const res3 = await upload('cv 3');
      expect(res3.status).toBe(400);
      const data = await res3.json();
      expect(data.error.message).toMatch(/máximo de archivos/i);
    } finally {
      await close();
    }
  });

  it('DELETE /api/uploads/:token removes only owned token and rejects foreign token', async () => {
    const { baseUrl, storage, close } = await setupApp();
    try {
      // Upload as session-1
      const form = new FormData();
      form.append('targetId', 'diploma-davia');
      form.append('fieldKey', 'cv');
      form.append('file', new Blob([pdfBytes('cv content')], { type: 'application/pdf' }), 'cv.pdf');

      const uploadRes = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'x-preinscription-session': 'session-1' },
        body: form,
      });
      const { token } = (await uploadRes.json()) as { token: string };

      // Attempt delete from foreign session: rejected (404/403)
      const foreignDelete = await fetch(`${baseUrl}/${token}`, {
        method: 'DELETE',
        headers: { 'x-preinscription-session': 'session-other' },
      });
      expect([403, 404]).toContain(foreignDelete.status);

      // Attempt delete from owner session: succeeds
      const ownerDelete = await fetch(`${baseUrl}/${token}`, {
        method: 'DELETE',
        headers: { 'x-preinscription-session': 'session-1' },
      });
      expect([200, 204]).toContain(ownerDelete.status);

      // Storage should no longer have the file
      await expect(storage.open(token, 'session-1')).rejects.toThrow();
    } finally {
      await close();
    }
  });

  it('DELETE /api/uploads/:token answers 409 and keeps the file once a submission pinned it', async () => {
    const { baseUrl, storage, close } = await setupApp();
    try {
      const form = new FormData();
      form.append('targetId', 'diploma-davia');
      form.append('fieldKey', 'cv');
      form.append('file', new Blob([pdfBytes('cv content')], { type: 'application/pdf' }), 'cv.pdf');
      const uploadRes = await fetch(baseUrl, { method: 'POST', headers: { 'x-preinscription-session': 'session-1' }, body: form });
      const { token } = (await uploadRes.json()) as { token: string };

      await (storage as TemporaryFileStorage).pinFiles([token], 'session-1', 'client-1');

      const late = await fetch(`${baseUrl}/${token}`, { method: 'DELETE', headers: { 'x-preinscription-session': 'session-1' } });
      expect(late.status).toBe(409);
      expect(((await late.json()) as { error: { code: string } }).error.code).toBe('FILE_ALREADY_SUBMITTED');
      expect((await storage.open(token, 'session-1')).data.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});
