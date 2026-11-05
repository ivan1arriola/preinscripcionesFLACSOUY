import { describe, expect, it } from 'vitest';
import express from 'express';
import { createSubmissionRoutes } from './submission-routes.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SubmissionProcessingRepository } from '../../ports/submission-processing-repository.js';
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

function setup(options: { driveDelayMs?: number; driveFails?: boolean } = {}) {
  const renewals: Array<{ id: string; owner: string }> = [];
  const releases: Array<{ id: string; owner: string }> = [];
  const processing: Pick<SubmissionProcessingRepository, 'renewLease' | 'releaseLease'> = {
    async renewLease(id, owner) { renewals.push({ id, owner }); return true; },
    async releaseLease(id, owner) { releases.push({ id, owner }); return true; },
  };
  const catalog: AcademicCatalog = {
    getTarget: async () => target, listTargets: async () => [target],
    revalidateTarget: async () => target, revalidateTargets: async () => [target],
  };
  const repository = new InMemorySubmissionRepository();
  const storage: TemporaryFileStoragePort = {
    save: async () => { throw new Error('unused'); },
    open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
    remove: async () => undefined,
    cleanup: async () => 0,
  };
  const drive: GoogleDriveRepositoryPort = {
    storeSubmissionFiles: async () => {
      await new Promise((resolve) => setTimeout(resolve, options.driveDelayMs ?? 0));
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
  app.use('/targets/:id/submissions', createSubmissionRoutes(
    catalog, repository, { storage, drive }, undefined, undefined, undefined, undefined, undefined, undefined,
    { repository: processing, renewEveryMs: 10, ttlMs: 60_000 },
  ));
  return { app, renewals, releases };
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

describe('Submission route lease (P4)', () => {
  it('renews the lease while the submission is processing and releases it when done', async () => {
    const { app, renewals, releases } = setup({ driveDelayMs: 120 });
    const res = await post(app, { clientSubmissionId: 'l-1', configRevision: revision, values, files });
    expect(res.status).toBe(201);
    expect(renewals.length).toBeGreaterThanOrEqual(3);
    expect(releases).toHaveLength(1);
    expect(releases[0]?.owner).toBe(renewals[0]?.owner);
    expect(releases[0]?.id).toBe(res.json.submissionId);
  });

  it('stops renewing after the request ends (no timer leaks)', async () => {
    const { app, renewals } = setup({ driveDelayMs: 50 });
    await post(app, { clientSubmissionId: 'l-2', configRevision: revision, values, files });
    const after = renewals.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(renewals.length).toBe(after);
  });

  it('releases the lease on the 202 failure path too', async () => {
    const { app, releases } = setup({ driveFails: true });
    const res = await post(app, { clientSubmissionId: 'l-3', configRevision: revision, values, files });
    expect(res.status).toBe(202);
    expect(releases).toHaveLength(1);
  });

  it('does not touch leases for an already accepted clientSubmissionId', async () => {
    const { app, renewals, releases } = setup();
    await post(app, { clientSubmissionId: 'l-4', configRevision: revision, values, files });
    const r = renewals.length;
    const l = releases.length;
    const retry = await post(app, { clientSubmissionId: 'l-4', configRevision: revision, values, files });
    expect(retry.json.existing).toBe(true);
    expect(renewals.length).toBe(r);
    expect(releases.length).toBe(l);
  });
});
