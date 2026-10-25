import { describe, expect, it } from 'vitest';
import express from 'express';
import { createSubmissionRoutes } from './submission-routes.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import { TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';
import type { TargetSpreadsheetRepository } from '../../ports/target-spreadsheet-repository.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { SpreadsheetSchemaRepairError } from '../../infrastructure/google/google-sheets-repository.js';


const target = {
  id: 'offer-1',
  kind: 'seminar' as const,
  title: 'Seminario Test',
  registrationOpen: true,
  configRevision: 'rev-1',
  seminar: {
    id: 1,
    slug: 'seminar-test',
    name: 'Seminario Test',
    type: 'seminar' as const,
    orientations: [],
    mentions: [],
  },
  orientations: [],
  mentions: [],
};

const values = {
  nombre1: 'Ana',
  nombre2: '',
  apellido1: 'Pérez',
  apellido2: '',
  email: 'ana@example.com',
  fechaNacimiento: '1980-01-01',
  tipoDocumento: 'cedula_uruguaya',
  documento: '34567894',
  paisEmisorDocumento: 'Uruguay',
  genero: 'Mujer',
  generoOtra: '',
  etnia: 'No declara',
  celular: '+59899123456',
  domicilio: 'Montevideo',
  ciudadResidencia: 'Montevideo',
  ocupacion: 'Docente',
  paisNacimiento: 'Uruguay',
  paisResidencia: 'Uruguay',
  tieneConvenio: 'No',
  convenioWordpressId: '',
  fuente: 'Web',
  aceptaDifusion: 'No',
  estudios: 'Licenciatura',
  posgradoFlacso: 'No',
  tituloDenominacion: 'Licenciatura',
  sinTituloActual: 'No',
  institucion: 'UdelaR',
};

const testFiles = [
  { token: 'tmp-1', fieldKey: 'identidad', originalName: 'cedula.pdf', size: 3, mimeType: 'application/pdf' },
  { token: 'tmp-2', fieldKey: 'cv', originalName: 'cv.pdf', size: 3, mimeType: 'application/pdf' },
  { token: 'tmp-3', fieldKey: 'titulo', originalName: 'titulo.pdf', size: 3, mimeType: 'application/pdf' },
  { token: 'tmp-4', fieldKey: 'cartaMotivacion', originalName: 'carta.pdf', size: 3, mimeType: 'application/pdf' },
];

async function setup(drive: GoogleDriveRepositoryPort, spreadsheet?: SpreadsheetRepository) {
  const effectiveRevision = `${target.configRevision}:canonical-v1`;

  const catalog: AcademicCatalog = {
    getTarget: async () => target,
    listTargets: async () => [target],
    revalidateTarget: async () => target,
    revalidateTargets: async () => [target],
  };
  const repository: SubmissionRepository = new InMemorySubmissionRepository();
  const storage: TemporaryFileStoragePort = {
    save: async () => { throw new Error('unused'); },
    open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
    remove: async () => undefined,
    cleanup: async () => 0,
  };
  const app = express();
  app.use(express.json());
  const targetSpreadsheetService = spreadsheet
    ? new TargetSpreadsheetService(
        {
          ensureTarget: async () => undefined,
          get: async () => ({ targetId: target.id, spreadsheetId: 'sheet-1', sheetName: 'Inscripciones' }),
          list: async () => [],
          save: async () => undefined,
        } satisfies TargetSpreadsheetRepository,
        { create: async () => ({ spreadsheetId: 'unused', sheetName: 'Inscripciones' }) },
        async () => 'drive-root',
        'Inscripciones',
      )
    : undefined;
  app.use('/targets/:id/submissions', createSubmissionRoutes(
    catalog,
    repository,
    { storage, drive },
    spreadsheet && targetSpreadsheetService ? { repository: spreadsheet, targetSpreadsheetService } : undefined,
  ));
  return { app, storage, effectiveRevision };
}


describe('Submission file orchestration', () => {
  it('sends temporary files to Drive and removes them only after success', async () => {
    let removed = false;
    const drive: GoogleDriveRepositoryPort = {
      storeSubmissionFiles: async () => ({
        files: testFiles.map((f, i) => ({ token: f.token, driveFileId: `drive-${i + 1}` })),
        documentsFolderId: 'folder-1',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
      }),
    };
    const { app, storage, effectiveRevision } = await setup(drive);
    storage.remove = async () => { removed = true; };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: testFiles }),
      });
      expect(response.status).toBe(201);
      expect(removed).toBe(true);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('keeps temporary files when Drive fails', async () => {
    let removed = false;
    const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async () => { throw new Error('Drive caído'); } };
    const { app, storage, effectiveRevision } = await setup(drive);
    storage.remove = async () => { removed = true; };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: testFiles }),
      });
      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data.submissionId).toBeDefined();
      expect(data.status).toBe('pending_processing');
      expect(removed).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('writes the submission to Sheets before removing temporary files', async () => {
    const events: string[] = [];
    let appendCommand: { spreadsheetId: string; valuesByColumnName: Record<string, string>; requiredColumns: string[]; sheetName?: string } | undefined;
    const drive: GoogleDriveRepositoryPort = {
      storeSubmissionFiles: async () => {
        events.push('drive');
        return {
          files: testFiles.map((f, i) => ({ token: f.token, driveFileId: `drive-${i + 1}` })),
          documentsFolderId: 'folder-1',
          documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
        };
      },
    };
    const spreadsheet: SpreadsheetRepository = {
      readHeaders: async () => [],
      appendByHeaders: async (...args) => {
        events.push('sheets');
        appendCommand = {
          spreadsheetId: args[0],
          valuesByColumnName: args[1],
          requiredColumns: args[2],
          sheetName: args[3],
        };
        return {
          spreadsheetId: args[0],
          sheetName: args[3] ?? 'Inscripciones',
          sheetId: 0,
          updatedRange: 'Inscripciones!A2:Z2',
          rowUrl: `https://docs.google.com/spreadsheets/d/${args[0]}/edit#gid=0&range=A2:Z2`,
          updatedRows: 1,
        };
      },
      diagnose: async () => ({ spreadsheetId: 'sheet-1', accessible: true, sheetFound: true, headerDiagnostic: { valid: true, foundColumns: [], missingColumns: [], extraColumns: [] } }),
    };
    const { app, storage, effectiveRevision } = await setup(drive, spreadsheet);
    storage.remove = async () => { events.push('remove'); };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: testFiles }),
      });
      expect(response.status).toBe(201);
      expect(events).toEqual(['drive', 'sheets', 'remove', 'remove', 'remove', 'remove']);
      expect(appendCommand?.spreadsheetId).toBe('sheet-1');
      expect(appendCommand?.sheetName).toBe('Inscripciones');
      expect(appendCommand?.valuesByColumnName['Primer nombre']).toBe('Ana');
      expect(appendCommand?.valuesByColumnName['Primer apellido']).toBe('Pérez');
      expect(appendCommand?.requiredColumns).toContain('Primer nombre');
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('keeps temporary files when Sheets fails after Drive succeeds', async () => {
    let removed = false;
    const drive: GoogleDriveRepositoryPort = {
      storeSubmissionFiles: async () => ({
        files: testFiles.map((f, i) => ({ token: f.token, driveFileId: `drive-${i + 1}` })),
        documentsFolderId: 'folder-1',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
      }),
    };
    const spreadsheet: SpreadsheetRepository = {
      readHeaders: async () => [],
      appendByHeaders: async () => { throw new Error('Sheets caído'); },
      diagnose: async () => ({ spreadsheetId: 'sheet-1', accessible: false, sheetFound: false, headerDiagnostic: { valid: false, foundColumns: [], missingColumns: [], extraColumns: [] } }),
    };
    const { app, storage, effectiveRevision } = await setup(drive, spreadsheet);
    storage.remove = async () => { removed = true; };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: testFiles }),
      });
      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data.submissionId).toBeDefined();
      expect(data.status).toBe('pending_processing');
      expect(removed).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('does not fail submission if cleanup fails after Drive and Sheets succeed', async () => {
    const drive: GoogleDriveRepositoryPort = {
      storeSubmissionFiles: async () => ({
        files: testFiles.map((f, i) => ({ token: f.token, driveFileId: `drive-${i + 1}` })),
        documentsFolderId: 'folder-1',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
      }),
    };
    const spreadsheet: SpreadsheetRepository = {
      readHeaders: async () => [],
      appendByHeaders: async () => ({
        spreadsheetId: 'sheet-1',
        sheetName: 'Inscripciones',
        sheetId: 0,
        updatedRange: 'Inscripciones!A2:Z2',
        rowUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0&range=A2:Z2',
        updatedRows: 1,
      }),
      diagnose: async () => ({ spreadsheetId: 'sheet-1', accessible: true, sheetFound: true, headerDiagnostic: { valid: true, foundColumns: [], missingColumns: [], extraColumns: [] } }),
    };
    const { app, storage, effectiveRevision } = await setup(drive, spreadsheet);
    storage.remove = async () => { throw new Error('Disco de uploads bloqueado'); };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: testFiles }),
      });
      expect(response.status).toBe(201);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('preserves temporary files and responds with 202 when Sheets encounters a SpreadsheetSchemaRepairError', async () => {
    let removed = false;
    const drive: GoogleDriveRepositoryPort = {
      storeSubmissionFiles: async () => ({
        files: testFiles.map((f, i) => ({ token: f.token, driveFileId: `drive-${i + 1}` })),
        documentsFolderId: 'folder-1',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
      }),
    };
    const spreadsheet: SpreadsheetRepository = {
      readHeaders: async () => [],
      appendByHeaders: async () => {
        throw new SpreadsheetSchemaRepairError(['Ciudad de residencia']);
      },
      diagnose: async () => ({
        spreadsheetId: 'sheet-1',
        accessible: true,
        sheetFound: true,
        headerDiagnostic: { valid: false, foundColumns: [], missingColumns: ['Ciudad de residencia'], extraColumns: [] },
      }),
    };
    const { app, storage, effectiveRevision } = await setup(drive, spreadsheet);
    storage.remove = async () => { removed = true; };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/targets/offer-1/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: testFiles }),
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.submissionId).toBeDefined();
      expect(body.status).toBe('pending_processing');
      expect(removed).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
