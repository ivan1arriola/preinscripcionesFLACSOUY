import { describe, expect, it } from 'vitest';
import express from 'express';
import { createSubmissionRoutes } from './submission-routes.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';

const target = {
  id: 'offer-1',
  kind: 'seminar' as const,
  title: 'Seminario Test',
  registrationOpen: true,
  configRevision: 'rev-1',
  seminar: { id: 1, slug: 'seminar-test', name: 'Seminario Test', type: 'seminar' as const, orientations: [], mentions: [] },
  orientations: [],
  mentions: [],
};

const values = {
  nombre1: 'Ana', nombre2: '', apellido1: 'Pérez', apellido2: '', email: 'ana@example.com', fechaNacimiento: '1980-01-01',
  tipoDocumento: 'cedula_uruguaya', documento: '34567894', paisEmisorDocumento: 'Uruguay', genero: 'Mujer', generoOtra: '',
  etnia: 'No declara', celular: '+59899123456', domicilio: 'Montevideo', ciudadResidencia: 'Montevideo', ocupacion: 'Docente',
  paisNacimiento: 'Uruguay', paisResidencia: 'Uruguay', tieneConvenio: 'No', convenioWordpressId: '', fuente: 'Web',
  aceptaDifusion: 'No', aceptaComunicaciones: 'Si', estudios: 'Licenciatura', posgradoFlacso: 'No',
  tituloDenominacion: 'Licenciatura', sinTituloActual: 'No', institucion: 'UdelaR',
};

const files = [
  { token: 'tmp-1', fieldKey: 'identidad', originalName: 'cedula.pdf', size: 3, mimeType: 'application/pdf' },
  { token: 'tmp-2', fieldKey: 'cv', originalName: 'cv.pdf', size: 3, mimeType: 'application/pdf' },
  { token: 'tmp-3', fieldKey: 'titulo', originalName: 'titulo.pdf', size: 3, mimeType: 'application/pdf' },
  { token: 'tmp-4', fieldKey: 'cartaMotivacion', originalName: 'carta.pdf', size: 3, mimeType: 'application/pdf' },
];

const revision = `${target.configRevision}:canonical-v2`;

function setup(options: { pinFiles?: TemporaryFileStoragePort['pinFiles']; driveFails?: boolean } = {}) {
  const events: string[] = [];
  const catalog: AcademicCatalog = {
    getTarget: async () => target, listTargets: async () => [target],
    revalidateTarget: async () => target, revalidateTargets: async () => [target],
  };
  const inner = new InMemorySubmissionRepository();
  const repository = Object.assign(Object.create(inner), {
    saveOrGet: async (submission: Parameters<typeof inner.saveOrGet>[0]) => {
      events.push('saveOrGet');
      return inner.saveOrGet(submission);
    },
  });
  const storage: TemporaryFileStoragePort = {
    save: async () => { throw new Error('unused'); },
    open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
    remove: async (token) => { events.push(`remove:${token}`); },
    cleanup: async () => 0,
    pinFiles: options.pinFiles ?? (async (tokens, sessionId, clientSubmissionId) => {
      events.push(`pin:${tokens.join(',')}:${sessionId}:${clientSubmissionId}`);
    }),
    releaseRetained: async (token) => { events.push(`release:${token}`); },
  };
  const drive: GoogleDriveRepositoryPort = {
    storeSubmissionFiles: async () => {
      if (options.driveFails) throw new Error('Drive caído');
      return {
        files: files.map((f, i) => ({ token: f.token, driveFileId: `drive-${i + 1}` })),
        documentsFolderId: 'folder-1',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/targets/:id/submissions', createSubmissionRoutes(catalog, repository, { storage, drive }));
  return { app, events };
}

async function post(app: express.Express, body: Record<string, unknown>) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Submission route file pinning (P1)', () => {
  it('pins the files after validation and before saving the submission', async () => {
    const { app, events } = setup();
    const res = await post(app, { clientSubmissionId: 'c-1', configRevision: revision, values, files });
    expect(res.status).toBe(201);
    expect(events.indexOf('pin:tmp-1,tmp-2,tmp-3,tmp-4:session-a:c-1')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('pin:tmp-1,tmp-2,tmp-3,tmp-4:session-a:c-1')).toBeLessThan(events.indexOf('saveOrGet'));
  });

  it('does not pin when the form fails validation', async () => {
    const { app, events } = setup();
    const res = await post(app, { clientSubmissionId: 'c-2', configRevision: revision, values: { ...values, email: '' }, files });
    expect(res.status).toBe(400);
    expect(events.some((e) => e.startsWith('pin:'))).toBe(false);
  });

  it('answers 400 FILE_EXPIRED and saves nothing when a file can no longer be pinned', async () => {
    const { app, events } = setup({
      pinFiles: async () => { throw Object.assign(new Error('El archivo ya venció.'), { code: 'FILE_EXPIRED' }); },
    });
    const res = await post(app, { clientSubmissionId: 'c-3', configRevision: revision, values, files });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('FILE_EXPIRED');
    expect(events).not.toContain('saveOrGet');
  });

  it('does not pin again when the same clientSubmissionId was already accepted', async () => {
    const { app, events } = setup();
    await post(app, { clientSubmissionId: 'c-4', configRevision: revision, values, files });
    const pinsBefore = events.filter((e) => e.startsWith('pin:')).length;
    const retry = await post(app, { clientSubmissionId: 'c-4', configRevision: revision, values, files });
    expect(retry.status).toBe(200);
    expect(retry.json.existing).toBe(true);
    expect(events.filter((e) => e.startsWith('pin:')).length).toBe(pinsBefore);
  });

  it('releases retained files (not the public remove) after a successful submission', async () => {
    const { app, events } = setup();
    await post(app, { clientSubmissionId: 'c-5', configRevision: revision, values, files });
    expect(events.filter((e) => e.startsWith('release:')).sort()).toEqual(['release:tmp-1', 'release:tmp-2', 'release:tmp-3', 'release:tmp-4']);
    expect(events.some((e) => e.startsWith('remove:'))).toBe(false);
  });

  it('keeps retained files when Drive fails', async () => {
    const { app, events } = setup({ driveFails: true });
    const res = await post(app, { clientSubmissionId: 'c-6', configRevision: revision, values, files });
    expect(res.status).toBe(202);
    expect(events.some((e) => e.startsWith('release:') || e.startsWith('remove:'))).toBe(false);
  });
});
