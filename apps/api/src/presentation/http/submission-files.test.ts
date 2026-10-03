import { describe, expect, it } from 'vitest';
import express from 'express';
import { createSubmissionRoutes } from './submission-routes.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import { MemoryFormProfileRepository } from '../../infrastructure/fixtures/memory-form-profile-repository.js';

import { composeForm } from '../../domain/form-composition.js';

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
  ocupacion: 'Docente',
  paisNacimiento: 'Uruguay',
  paisResidencia: 'Uruguay',
  tieneConvenio: 'No',
  convenioWordpressId: '',
  fuente: 'Web',
  aceptaDifusion: 'No',
  estudios: 'Licenciatura',
  posgradoFlacso: 'No',
  posgradoCual: '',
};

async function setup(drive: GoogleDriveRepositoryPort, spreadsheet?: SpreadsheetRepository) {
  const profileRepo = new MemoryFormProfileRepository({
    seminar: {
      steps: [{ id: 'general', title: 'General', order: 1 }],
      fields: [
        { key: 'nombre1', stepId: 'general', order: 1, required: true, condition: 'always' },
        { key: 'apellido1', stepId: 'general', order: 2, required: true, condition: 'always' },
        { key: 'email', stepId: 'general', order: 3, required: true, condition: 'always' },
        { key: 'fechaNacimiento', stepId: 'general', order: 4, required: true, condition: 'always' },
        { key: 'tipoDocumento', stepId: 'general', order: 5, required: true, condition: 'always' },
        { key: 'documento', stepId: 'general', order: 6, required: true, condition: 'always' },
        { key: 'genero', stepId: 'general', order: 7, required: true, condition: 'always' },
        { key: 'etnia', stepId: 'general', order: 8, required: true, condition: 'always' },
        { key: 'paisNacimiento', stepId: 'general', order: 9, required: true, condition: 'always' },
        { key: 'paisResidencia', stepId: 'general', order: 10, required: true, condition: 'always' },
        { key: 'domicilio', stepId: 'general', order: 11, required: true, condition: 'always' },
        { key: 'celular', stepId: 'general', order: 12, required: true, condition: 'always' },
        { key: 'ocupacion', stepId: 'general', order: 13, required: true, condition: 'always' },
        { key: 'estudios', stepId: 'general', order: 14, required: true, condition: 'always' },
        { key: 'posgradoFlacso', stepId: 'general', order: 15, required: true, condition: 'always' },
        { key: 'tieneConvenio', stepId: 'general', order: 16, required: true, condition: 'always' },
        { key: 'fuente', stepId: 'general', order: 17, required: true, condition: 'always' },
        { key: 'aceptaDifusion', stepId: 'general', order: 18, required: true, condition: 'always' },
      ],
      documents: [
        {
          key: 'cv',
          stepId: 'general',
          order: 1,
          label: 'CV',
          required: true,
          canDefer: false,
          maxFiles: 1,
          maxBytes: 10 * 1024 * 1024,
          acceptedMimeTypes: ['application/pdf'],
        },
      ],
    },
  });

  const activeProfile = await profileRepo.getActive('seminar');
  const composed = composeForm(target, activeProfile);
  if (!composed.ok) throw new Error(composed.error.message);
  const effectiveRevision = composed.value.effectiveRevision;

  const catalog: AcademicCatalog = {
    getTarget: async () => target,
    listTargets: async () => [target],
    revalidateTarget: async () => target,
    revalidateTargets: async () => [target],
  };
  const repository: SubmissionRepository = { save: async () => ({ id: 'sub_1' }) };
  const storage: TemporaryFileStoragePort = {
    save: async () => { throw new Error('unused'); },
    open: async () => ({ originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
    remove: async () => undefined,
    cleanup: async () => 0,
  };
  const app = express();
  app.use(express.json());
  app.use('/submissions', createSubmissionRoutes(
    catalog,
    repository,
    profileRepo,
    { storage, drive },
    spreadsheet ? { repository: spreadsheet, spreadsheetId: 'sheet-1', sheetName: 'Inscripciones' } : undefined,
  ));
  return { app, storage, effectiveRevision };
}

describe('Submission file orchestration', () => {
  it('sends temporary files to Drive and removes them only after success', async () => {
    let removed = false;
    const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async () => [{ token: 'tmp-1', driveFileId: 'drive-1' }] };
    const { app, storage, effectiveRevision } = await setup(drive);
    storage.remove = async () => { removed = true; };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: [{ token: 'tmp-1', fieldKey: 'cv', originalName: 'cv.pdf', size: 3, mimeType: 'application/pdf' }] }),
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
      const response = await fetch(`http://127.0.0.1:${address.port}/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: [{ token: 'tmp-1', fieldKey: 'cv', originalName: 'cv.pdf', size: 3, mimeType: 'application/pdf' }] }),
      });
      expect(response.status).toBe(502);
      expect(removed).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('writes the submission to Sheets before removing temporary files', async () => {
    const events: string[] = [];
    let appendCommand: { spreadsheetId: string; valuesByColumnName: Record<string, string>; requiredColumns: string[]; sheetName?: string } | undefined;
    const drive: GoogleDriveRepositoryPort = {
      storeSubmissionFiles: async () => {
        events.push('drive');
        return [{ token: 'tmp-1', driveFileId: 'drive-1' }];
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
        return { spreadsheetId: args[0], updatedRange: 'Inscripciones!A2:Z2', updatedRows: 1 };
      },
      diagnose: async () => ({ spreadsheetId: 'sheet-1', accessible: true, sheetFound: true, headerDiagnostic: { valid: true, foundColumns: [], missingColumns: [], extraColumns: [] } }),
    };
    const { app, storage, effectiveRevision } = await setup(drive, spreadsheet);
    storage.remove = async () => { events.push('remove'); };
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: [{ token: 'tmp-1', fieldKey: 'cv', originalName: 'cv.pdf', size: 3, mimeType: 'application/pdf' }] }),
      });
      expect(response.status).toBe(201);
      expect(events).toEqual(['drive', 'sheets', 'remove']);
      expect(appendCommand?.spreadsheetId).toBe('sheet-1');
      expect(appendCommand?.sheetName).toBe('Inscripciones');
      expect(appendCommand?.valuesByColumnName['Primer nombre']).toBe('Ana');
      expect(appendCommand?.valuesByColumnName['Primer apellido']).toBe('Pérez');
      expect(appendCommand?.requiredColumns).toContain('Primer nombre');
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('keeps temporary files when Sheets fails after Drive succeeds', async () => {
    let removed = false;
    const drive: GoogleDriveRepositoryPort = { storeSubmissionFiles: async () => [{ token: 'tmp-1', driveFileId: 'drive-1' }] };
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
      const response = await fetch(`http://127.0.0.1:${address.port}/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': 'session-a' },
        body: JSON.stringify({ configRevision: effectiveRevision, values, files: [{ token: 'tmp-1', fieldKey: 'cv', originalName: 'cv.pdf', size: 3, mimeType: 'application/pdf' }] }),
      });
      expect(response.status).toBe(502);
      expect(removed).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
