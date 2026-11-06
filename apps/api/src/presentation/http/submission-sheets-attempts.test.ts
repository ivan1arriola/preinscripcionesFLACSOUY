import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createSubmissionRoutes } from './submission-routes.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import type { SheetsAttemptRecord } from '../../ports/sheets-attempt-store.js';

const target = {
  id: 'offer-1', kind: 'seminar' as const, title: 'Seminario Test', registrationOpen: true, configRevision: 'rev-1',
  seminar: { id: 1, slug: 'seminar-test', name: 'Seminario Test', type: 'seminar' as const, orientations: [], mentions: [] },
  orientations: [], mentions: [],
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

function setup(appendFails: boolean) {
  const records = new Map<string, SheetsAttemptRecord>();
  const store = {
    get: async (id: string) => records.get(id) ?? null,
    recordAttemptStarted: async (id: string, at: Date) => { records.set(id, { submissionId: id, status: 'pending', sheetAttemptStartedAt: at, sheetWrittenAt: null, nextAttemptAt: null }); },
    markUncertain: async (id: string, next: Date) => { records.set(id, { ...records.get(id)!, status: 'sheet_uncertain', nextAttemptAt: next }); },
    recordWritten: async (id: string, at: Date) => { records.set(id, { ...records.get(id)!, sheetWrittenAt: at }); },
  };
  const tasks = { enqueueTask: vi.fn().mockResolvedValue(undefined) };
  const spreadsheet = {
    appendByHeaders: appendFails ? vi.fn().mockRejectedValue(new Error('ETIMEDOUT')) : vi.fn().mockResolvedValue({}),
    countTrackingId: vi.fn().mockResolvedValue(0),
  };
  const recoveries: Array<Record<string, unknown>> = [];
  const catalog: AcademicCatalog = {
    getTarget: async () => target, listTargets: async () => [target],
    revalidateTarget: async () => target, revalidateTargets: async () => [target],
  };
  const repository = new InMemorySubmissionRepository();
  const app = express();
  app.use(express.json());
  app.use('/targets/:id/submissions', createSubmissionRoutes(
    catalog, repository,
    {
      storage: {
        save: async () => { throw new Error('unused'); },
        open: async (token: string) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
        remove: async () => undefined, cleanup: async () => 0,
      } as never,
      drive: { storeSubmissionFiles: async () => ({ files: files.map((f, i) => ({ token: f.token, driveFileId: `d-${i}` })), documentsFolderId: 'f', documentsFolderUrl: 'https://drive.google.com/drive/folders/f' }) } as never,
    },
    {
      repository: spreadsheet as never,
      targetSpreadsheetService: { ensureForTarget: async () => ({ spreadsheetId: 'sheet-1', sheetName: 'Hoja' }) } as never,
      attempts: { store, tasks },
    },
    undefined,
    { repository: { recordFailure: async (input: Record<string, unknown>) => { recoveries.push(input); return { id: 'rec-1' }; } } as never },
  ));
  return { app, records, tasks, spreadsheet, recoveries };
}

async function post(app: express.Express, clientSubmissionId: string) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
      body: JSON.stringify({ clientSubmissionId, configRevision: revision, values, files }),
    });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Submission route with durable Sheets attempts (P3)', () => {
  it('a lost Sheets response leaves a visible sheets case, schedules the reconciliation and answers 202', async () => {
    const { app, records, tasks, recoveries } = setup(true);
    const res = await post(app, 's-1');
    expect(res.status).toBe(202);
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).toMatchObject({ stage: 'sheets' });
    expect(tasks.enqueueTask).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sheets_reconcile' }));
    const record = [...records.values()][0];
    expect(record?.status).toBe('sheet_uncertain');
    expect(record?.sheetWrittenAt).toBeNull();
  });

  it('a normal write confirms the row without reading the sheet or queuing anything', async () => {
    const { app, records, tasks, spreadsheet } = setup(false);
    const res = await post(app, 's-2');
    expect(res.status).toBe(201);
    expect([...records.values()][0]?.sheetWrittenAt).toBeInstanceOf(Date);
    expect(spreadsheet.countTrackingId).not.toHaveBeenCalled();
    expect(tasks.enqueueTask).not.toHaveBeenCalled();
  });
});
