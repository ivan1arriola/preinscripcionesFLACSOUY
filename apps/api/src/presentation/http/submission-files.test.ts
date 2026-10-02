import { describe, expect, it } from 'vitest';
import express from 'express';
import { createSubmissionRoutes } from './submission-routes.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';

const target = {
  id: 'offer-1', kind: 'academic_offer' as const, title: 'Oferta', registrationOpen: true, configRevision: 'rev-1',
  form: { valid: true, inputs: [], documents: [{ key: 'cv', position: 1, required: true }], issues: [] },
  orientations: [], mentions: [],
};

const values = {
  nombre1: 'Ana', nombre2: '', apellido1: 'Pérez', apellido2: '', email: 'ana@example.com', fechaNacimiento: '1980-01-01',
  tipoDocumento: 'cedula_uruguaya', documento: '34567894', paisEmisorDocumento: 'Uruguay', genero: 'Mujer', generoOtra: '',
  etnia: 'No declara', celular: '+59899123456', domicilio: 'Montevideo', ocupacion: 'Docente', paisNacimiento: 'Uruguay', paisResidencia: 'Uruguay',
  tieneConvenio: 'No', convenioWordpressId: '', fuente: 'Web', aceptaDifusion: 'No', estudios: 'Licenciatura', posgradoFlacso: 'No', posgradoCual: '',
};

function setup(drive: GoogleDriveRepositoryPort) {
  const catalog: AcademicCatalog = { getTarget: async () => target, listTargets: async () => [target], revalidateTarget: async () => target };
  const repository: SubmissionRepository = { save: async () => ({ id: 'sub_1' }) };
  const storage: TemporaryFileStoragePort = {
    save: async () => { throw new Error('unused'); },
    open: async () => ({ originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
    remove: async () => undefined,
    cleanup: async () => 0,
  };
  const app = express();
  app.use(express.json());
  app.use('/submissions', createSubmissionRoutes(catalog, repository, { storage, drive }));
  return { app, storage };
}

describe('Submission file orchestration', () => {
  it('sends temporary files to Drive and removes them only after success', async () => {
    let removed = false;
    const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async () => [{ token: 'tmp-1', driveFileId: 'drive-1' }] };
    const { app, storage } = setup(drive);
    storage.remove = async () => { removed = true; };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: 'rev-1', values, files: [{ token: 'tmp-1', fieldKey: 'cv', originalName: 'cv.pdf', size: 3, mimeType: 'application/pdf' }] }),
      });
      expect(response.status).toBe(201);
      expect(removed).toBe(true);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('keeps temporary files when Drive fails', async () => {
    let removed = false;
    const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async () => { throw new Error('Drive caído'); } };
    const { app, storage } = setup(drive);
    storage.remove = async () => { removed = true; };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: 'rev-1', values, files: [{ token: 'tmp-1', fieldKey: 'cv', originalName: 'cv.pdf', size: 3, mimeType: 'application/pdf' }] }),
      });
      expect(response.status).toBe(502);
      expect(removed).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
