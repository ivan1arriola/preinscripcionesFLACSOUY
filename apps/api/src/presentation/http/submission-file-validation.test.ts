import { describe, expect, it } from 'vitest';
import express from 'express';
import { createSubmissionRoutes } from './submission-routes.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { TemporaryFileRecord, TemporaryFileStoragePort } from '../../ports/file-storage.js';
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

/** Lo que el servidor todavía conserva de la sesión (lo vencido ya lo borró la limpieza). */
function record(token: string, fieldKey: string): TemporaryFileRecord {
  return { token, sessionId: 'session-a', fieldKey, originalName: `${token}.pdf`, mimeType: 'application/pdf', size: 3, createdAt: new Date() };
}

function setup(stored: TemporaryFileRecord[]) {
  const events: string[] = [];
  const catalog: AcademicCatalog = {
    getTarget: async () => target, listTargets: async () => [target],
    revalidateTarget: async () => target, revalidateTargets: async () => [target],
  };
  const storage: TemporaryFileStoragePort = {
    save: async () => { throw new Error('unused'); },
    open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
    remove: async () => undefined,
    cleanup: async () => 0,
    listBySession: async () => stored,
    pinFiles: async (tokens) => { events.push(`pin:${tokens.join(',')}`); },
    releaseRetained: async () => undefined,
  };
  const drive: GoogleDriveRepositoryPort = {
    storeSubmissionFiles: async () => ({
      files: files.map((f, i) => ({ token: f.token, driveFileId: `drive-${i + 1}` })),
      documentsFolderId: 'folder-1',
      documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
    }),
  };
  const app = express();
  app.use(express.json());
  app.use('/targets/:id/submissions', createSubmissionRoutes(catalog, new InMemorySubmissionRepository(), { storage, drive }));
  return { app, events };
}

async function post(app: express.Express) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
      body: JSON.stringify({ clientSubmissionId: 'c-1', configRevision: revision, values, files }),
    });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Validación de los archivos adjuntos contra la sesión', () => {
  it('acepta el envío cuando cada archivo sigue en la sesión y en su campo', async () => {
    const { app } = setup(files.map((f) => record(f.token, f.fieldKey)));
    expect((await post(app)).status).toBe(201);
  });

  it('responde FILE_EXPIRED, no «no corresponde al campo», cuando la limpieza ya borró archivos', async () => {
    // Pasaron más de 30 minutos entre algunas subidas y el envío: solo quedan identidad y carta.
    const { app, events } = setup([record('tmp-1', 'identidad'), record('tmp-4', 'cartaMotivacion')]);
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('FILE_EXPIRED');
    expect(events).toEqual([]); // no fija ni guarda nada
  });

  it('informa todos los campos con archivos vencidos para que la persona los recargue de una vez', async () => {
    const { app } = setup([record('tmp-1', 'identidad'), record('tmp-4', 'cartaMotivacion')]);
    const res = await post(app);
    expect(res.json.error.fields).toEqual(['cv', 'titulo']);
    expect(res.json.error.field).toBe('cv');
  });

  it('informa los cuatro campos si la sesión quedó sin archivos', async () => {
    const { app } = setup([]);
    const res = await post(app);
    expect(res.json.error.code).toBe('FILE_EXPIRED');
    expect(res.json.error.fields).toEqual(['identidad', 'cv', 'titulo', 'cartaMotivacion']);
  });

  it('mantiene INVALID_FILE solo cuando el archivo existe pero se subió para otro campo', async () => {
    const { app } = setup([
      record('tmp-1', 'identidad'), record('tmp-2', 'titulo'), record('tmp-3', 'titulo'), record('tmp-4', 'cartaMotivacion'),
    ]);
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('INVALID_FILE');
    expect(res.json.error.field).toBe('cv');
  });

  it('prioriza los archivos vencidos sobre los que están en otro campo', async () => {
    const { app } = setup([record('tmp-1', 'cv'), record('tmp-4', 'cartaMotivacion')]);
    expect((await post(app)).json.error.code).toBe('FILE_EXPIRED');
  });
});
