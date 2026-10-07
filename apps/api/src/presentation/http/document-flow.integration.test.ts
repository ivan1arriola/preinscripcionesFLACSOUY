import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { getTargetForm } from '../../application/get-target-form.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import { TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';
import type { TargetSpreadsheetRepository } from '../../ports/target-spreadsheet-repository.js';

describe('Document Flow Integration', () => {
  let server: Server;
  let baseUrl: string;
  let catalog: FixtureAcademicCatalog;
  let repository: InMemorySubmissionRepository;
  let storedDriveFiles: Array<{ token: string; driveFileId: string }>;
  let appendedSpreadsheetRows: Array<Record<string, string>>;

  const dummyFileStorage: TemporaryFileStoragePort = {
    save: async () => ({
      token: 'tok-dummy',
      sessionId: 'sess-test',
      fieldKey: 'identidad',
      originalName: 'dummy.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      createdAt: new Date(),
    }),
    open: async (token) => ({
      originalName: `${token}.pdf`,
      mimeType: 'application/pdf',
      data: Buffer.from('%PDF-1.4 test document'),
      createdAt: new Date(),
    }),
    remove: async () => undefined,
    cleanup: async () => 0,
  };

  const dummyDriveRepo: GoogleDriveRepositoryPort = {
    storeSubmissionFiles: async ({ files }) => {
      const results = files.map((f, i) => ({
        token: f.token,
        driveFileId: `drive-${f.token}-${i}`,
      }));
      storedDriveFiles.push(...results);
      return {
        files: results.map((r) => ({ token: r.token, driveFileId: r.driveFileId })),
        documentsFolderId: 'folder-doc',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-doc',
      };
    },
  };

  const dummySpreadsheetRepo: SpreadsheetRepository = {
    readHeaders: async () => [],
    appendByHeaders: async (spreadsheetId, valuesByColumnName, _requiredColumns, sheetName) => {
      appendedSpreadsheetRows.push(valuesByColumnName);
      return {
        spreadsheetId,
        sheetName: sheetName || 'Inscripciones',
        sheetId: 0,
        updatedRange: `${sheetName || 'Inscripciones'}!A1:Z1`,
        rowUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0&range=A1:Z1`,
        updatedRows: 1,
      };
    },
    diagnose: async () => ({
      spreadsheetId: 'sheet-1',
      accessible: true,
      sheetFound: true,
      headerDiagnostic: { valid: true, foundColumns: [], missingColumns: [], extraColumns: [] },
    }),
  };

  const dummyTargetSpreadsheetRepo: TargetSpreadsheetRepository = {
    ensureTarget: async () => undefined,
    get: async (targetId) => ({ targetId, spreadsheetId: `sheet-${targetId}`, sheetName: 'Inscripciones' }),
    list: async () => [],
    save: async () => undefined,
  };

  const dummyTargetSpreadsheetService = new TargetSpreadsheetService(
    dummyTargetSpreadsheetRepo,
    { create: async () => ({ spreadsheetId: 'created-sheet', sheetName: 'Inscripciones' }) },
    async () => 'drive-root-id',
    'Inscripciones',
  );

  beforeAll(async () => {
    catalog = new FixtureAcademicCatalog();
    repository = new InMemorySubmissionRepository();

    storedDriveFiles = [];
    appendedSpreadsheetRows = [];

    const app = createApp({
      catalog,
      repository,
      temporaryFileStorage: dummyFileStorage,
      googleDriveRepository: dummyDriveRepo,
      spreadsheetRepository: dummySpreadsheetRepo,
      targetSpreadsheetService: dummyTargetSpreadsheetService,
      targetSpreadsheetRepository: dummyTargetSpreadsheetRepo,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('Flow 1: Diploma (non-master) with identity, CV, title and motivation', async () => {
    storedDriveFiles = [];
    appendedSpreadsheetRows = [];

    const targetId = 'davia-c11';
    const formResult = await getTargetForm(catalog, targetId);
    if (!formResult.ok) throw new Error(formResult.message);

    const payload = {
      clientSubmissionId: 'sub-flow-1-idempotency',
      configRevision: formResult.form.effectiveRevision,
      values: {
        nombre1: 'Ana',
        apellido1: 'Pérez',
        fechaNacimiento: '1990-01-01',
        tipoDocumento: 'cedula_uruguaya',
        documento: '34567894',
        genero: 'Mujer',
        etnia: 'No declara',
        paisNacimiento: 'Uruguay',
        paisResidencia: 'Uruguay',
        ciudadResidencia: 'Montevideo',
        celular: '99123456',
        email: 'ana.perez@example.com',
        ocupacion: 'Docente',
        estudios: 'Licenciatura',
        posgradoFlacso: 'No',
        institucion: 'UdelaR',
        orientacion: 'Educación',
        mencion: 'Tecnología Educativa',
        tituloDenominacion: 'Licenciada en Educación',
        sinTituloActual: 'No',
        tieneConvenio: 'No',
        fuente: 'Web',
        aceptaDifusion: 'Si',
      },
      files: [
        { fieldKey: 'identidad', token: 'tok_fl1_id', originalName: 'cedula.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cv', token: 'tok_fl1_cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'titulo', token: 'tok_fl1_tit', originalName: 'titulo.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cartaMotivacion', token: 'tok_fl1_mot', originalName: 'carta.pdf', mimeType: 'application/pdf', size: 1024 },
      ],
    };

    const res = await fetch(`${baseUrl}/api/targets/${targetId}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-preinscription-session': 'sess-test',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submissionId).toBeDefined();

    // Verify 4 files stored to Drive
    expect(storedDriveFiles.length).toBe(4);
    expect(storedDriveFiles.map((f) => f.token)).toEqual(['tok_fl1_id', 'tok_fl1_cv', 'tok_fl1_tit', 'tok_fl1_mot']);

    // Verify Sheets row
    expect(appendedSpreadsheetRows.length).toBe(1);
    const row = appendedSpreadsheetRows[0]!;
    expect(row['Denominación del título']).toBe('Licenciada en Educación');
    expect(row['No posee actualmente título']).toBeUndefined();
    expect(row['Primer nombre']).toBe('Ana');
    expect(row['Primer apellido']).toBe('Pérez');
  });

  it('Flow 2: Maestría with recommendation letters attached now', async () => {
    storedDriveFiles = [];
    appendedSpreadsheetRows = [];

    const targetId = 'maestria-genero-c9';
    const formResult = await getTargetForm(catalog, targetId);
    if (!formResult.ok) throw new Error(formResult.message);

    const payload = {
      clientSubmissionId: 'sub-flow-2-idempotency',
      configRevision: formResult.form.effectiveRevision,
      values: {
        nombre1: 'Laura',
        apellido1: 'Gómez',
        fechaNacimiento: '1988-04-12',
        tipoDocumento: 'cedula_uruguaya',
        documento: '34567894',
        genero: 'Mujer',
        etnia: 'No declara',
        paisNacimiento: 'Uruguay',
        paisResidencia: 'Uruguay',
        ciudadResidencia: 'Montevideo',
        celular: '99123456',
        email: 'laura.gomez@example.com',
        ocupacion: 'Investigadora',
        estudios: 'Universitario Completo',
        posgradoFlacso: 'No',
        institucion: 'UdelaR',
        orientacion: 'Género y Políticas Públicas',
        tituloDenominacion: 'Licenciatura en Sociología',
        sinTituloActual: 'No',
        cartaRecomendacion1Pendiente: 'No',
        cartaRecomendacion2Pendiente: 'No',
        tieneConvenio: 'No',
        fuente: 'Web',
        aceptaDifusion: 'Si',
      },
      files: [
        { fieldKey: 'identidad', token: 'tok_fl2_id', originalName: 'cedula.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cv', token: 'tok_fl2_cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'titulo', token: 'tok_fl2_tit', originalName: 'titulo.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cartaMotivacion', token: 'tok_fl2_mot', originalName: 'carta.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cartaRecomendacion1', token: 'tok_fl2_rec1', originalName: 'rec1.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cartaRecomendacion2', token: 'tok_fl2_rec2', originalName: 'rec2.pdf', mimeType: 'application/pdf', size: 1024 },
      ],
    };

    const res = await fetch(`${baseUrl}/api/targets/${targetId}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-preinscription-session': 'sess-test',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submissionId).toBeDefined();

    // Verify 6 files stored to Drive
    expect(storedDriveFiles.length).toBe(6);
    expect(storedDriveFiles.map((f) => f.token)).toEqual([
      'tok_fl2_id',
      'tok_fl2_cv',
      'tok_fl2_tit',
      'tok_fl2_mot',
      'tok_fl2_rec1',
      'tok_fl2_rec2',
    ]);

    // Verify Sheets row
    expect(appendedSpreadsheetRows.length).toBe(1);
    const row = appendedSpreadsheetRows[0]!;
    expect(row['Denominación del título']).toBe('Licenciatura en Sociología');
    expect(row['No posee actualmente título']).toBeUndefined();
    expect(row['Carta de recomendación 1 pendiente']).toBeUndefined();
    expect(row['Carta de recomendación 2 pendiente']).toBeUndefined();
  });

  it('Flow 3: Maestría with recommendations marked for later submission', async () => {
    storedDriveFiles = [];
    appendedSpreadsheetRows = [];

    const targetId = 'maestria-genero-c9';
    const formResult = await getTargetForm(catalog, targetId);
    if (!formResult.ok) throw new Error(formResult.message);

    const payload = {
      clientSubmissionId: 'sub-flow-3-idempotency',
      configRevision: formResult.form.effectiveRevision,
      values: {
        nombre1: 'Martina',
        apellido1: 'Silva',
        fechaNacimiento: '1991-03-10',
        tipoDocumento: 'cedula_uruguaya',
        documento: '34567894',
        genero: 'Mujer',
        etnia: 'No declara',
        paisNacimiento: 'Uruguay',
        paisResidencia: 'Uruguay',
        ciudadResidencia: 'Montevideo',
        celular: '99123456',
        email: 'martina.silva@example.com',
        ocupacion: 'Investigadora',
        estudios: 'Universitario Completo',
        posgradoFlacso: 'No',
        institucion: 'UdelaR',
        orientacion: 'Género y Políticas Públicas',
        tituloDenominacion: 'Licenciatura en Psicología',
        sinTituloActual: 'No',
        tieneConvenio: 'No',
        fuente: 'Web',
        aceptaDifusion: 'Si',
      },
      files: [
        { fieldKey: 'identidad', token: 'tok_fl3_id', originalName: 'cedula.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cv', token: 'tok_fl3_cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'titulo', token: 'tok_fl3_tit', originalName: 'titulo.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cartaMotivacion', token: 'tok_fl3_mot', originalName: 'carta.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cartaRecomendacion1', token: 'tok_fl3_rec1', originalName: 'rec1.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cartaRecomendacion2', token: 'tok_fl3_rec2', originalName: 'rec2.pdf', mimeType: 'application/pdf', size: 1024 },
      ],
    };

    const res = await fetch(`${baseUrl}/api/targets/${targetId}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-preinscription-session': 'sess-test',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submissionId).toBeDefined();

    // Verify all 6 required files are stored to Drive
    expect(storedDriveFiles.length).toBe(6);
    expect(storedDriveFiles.map((f) => f.token)).toEqual(['tok_fl3_id', 'tok_fl3_cv', 'tok_fl3_tit', 'tok_fl3_mot', 'tok_fl3_rec1', 'tok_fl3_rec2']);

    // Verify Sheets row
    expect(appendedSpreadsheetRows.length).toBe(1);
    const row = appendedSpreadsheetRows[0]!;
    expect(row['Denominación del título']).toBe('Licenciatura en Psicología');
    expect(row['No posee actualmente título']).toBeUndefined();
    expect(row['Carta de recomendación 1 pendiente']).toBeUndefined();
    expect(row['Carta de recomendación 2 pendiente']).toBeUndefined();
  });

  it('Flow 4: Seminar with title absence declaration and no motivation/recommendation', async () => {
    storedDriveFiles = [];
    appendedSpreadsheetRows = [];

    const targetId = 'seminario-metodologia-ed3';
    const formResult = await getTargetForm(catalog, targetId);
    if (!formResult.ok) throw new Error(formResult.message);

    const payload = {
      clientSubmissionId: 'sub-flow-4-idempotency',
      configRevision: formResult.form.effectiveRevision,
      values: {
        nombre1: 'Mateo',
        apellido1: 'Rodríguez',
        fechaNacimiento: '1995-11-20',
        tipoDocumento: 'cedula_uruguaya',
        documento: '34567894',
        genero: 'Varon',
        etnia: 'No declara',
        paisNacimiento: 'Uruguay',
        paisResidencia: 'Uruguay',
        ciudadResidencia: 'Montevideo',
        celular: '99123456',
        email: 'mateo.rodriguez@example.com',
        ocupacion: 'Estudiante',
        estudios: 'Terciario',
        posgradoFlacso: 'No',
        institucion: 'IPA',
        tituloDenominacion: '',
        sinTituloActual: 'Si',
        tieneConvenio: 'No',
        fuente: 'Web',
        aceptaDifusion: 'Si',
      },
      files: [
        { fieldKey: 'identidad', token: 'tok_fl4_id', originalName: 'cedula.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cv', token: 'tok_fl4_cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 1024 },
      ],
    };

    const res = await fetch(`${baseUrl}/api/targets/${targetId}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-preinscription-session': 'sess-test',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submissionId).toBeDefined();

    // Verify 2 files stored to Drive (only identity and CV)
    expect(storedDriveFiles.length).toBe(2);
    expect(storedDriveFiles.map((f) => f.token)).toEqual(['tok_fl4_id', 'tok_fl4_cv']);

    // Verify Sheets row
    expect(appendedSpreadsheetRows.length).toBe(1);
    const row = appendedSpreadsheetRows[0]!;
    expect(row['Denominación del título']).toBe('No posee actualmente título');
    expect(row['No posee actualmente título']).toBeUndefined();
    expect(row['Carta de recomendación 1 pendiente']).toBeUndefined();
    expect(row['Carta de recomendación 2 pendiente']).toBeUndefined();
  });
});
