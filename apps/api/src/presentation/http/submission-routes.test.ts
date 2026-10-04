import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { FixtureAcademicCatalog } from '../../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../../infrastructure/database/in-memory-submission-repository.js';
import { MemoryFormProfileRepository } from '../../infrastructure/fixtures/memory-form-profile-repository.js';
import { getTargetForm } from '../../application/get-target-form.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';

describe('Submission HTTP Routes', () => {
  let server: Server;
  let baseUrl: string;
  let repository: InMemorySubmissionRepository;

  const validPayload = {
    configRevision: 'davia-c11-v1',
    values: {
      nombre1: 'Lucía',
      nombre2: '',
      apellido1: 'Méndez',
      apellido2: '',
      email: 'lucia@example.com',
      fechaNacimiento: '1992-03-20',
      tipoDocumento: 'cedula_uruguaya',
      documento: '34567894',
      paisEmisorDocumento: 'Uruguay',
      genero: 'Mujer',
      etnia: 'No declara',
      celular: '+59899123456',
      ciudadResidencia: 'Montevideo',
      domicilio: 'Montevideo',
      ocupacion: 'Docente',
      paisNacimiento: 'Uruguay',
      paisResidencia: 'Uruguay',
      tieneConvenio: 'No',
      fuente: 'Web',
      aceptaDifusion: 'No',
      estudios: 'Profesorado',
      posgradoFlacso: 'No',
      posgradoCual: '',
      orientacion: 'Educación',
      mencion: 'Tecnología Educativa',
      tituloDenominacion: 'Profesora de Historia',
      sinTituloActual: 'No',
      institucion: 'Universidad de la República',
    },
    files: [
      { fieldKey: 'identidad', token: 'tok_id', originalName: 'cedula.pdf', mimeType: 'application/pdf', size: 1024 },
      { fieldKey: 'cv', token: 'tok_cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 1024 },
      { fieldKey: 'titulo', token: 'tok_tit', originalName: 'titulo.pdf', mimeType: 'application/pdf', size: 1024 },
      { fieldKey: 'cartaMotivacion', token: 'tok_mot', originalName: 'carta.pdf', mimeType: 'application/pdf', size: 1024 },
    ],
  };

  beforeAll(async () => {
    const catalog = new FixtureAcademicCatalog();
    repository = new InMemorySubmissionRepository();
    const profileRepo = new MemoryFormProfileRepository();
    const formResult = await getTargetForm(catalog, profileRepo, 'davia-c11');
    if (!formResult.ok) throw new Error(formResult.message);
    validPayload.configRevision = formResult.form.effectiveRevision;
    const storage: TemporaryFileStoragePort = {
      save: async () => ({ token: 'unused', sessionId: 'sess-1', fieldKey: 'identidad', originalName: '', mimeType: '', size: 0, createdAt: new Date() }),
      open: async (token) => ({ originalName: `${token}.pdf`, mimeType: 'application/pdf', data: Buffer.from('pdf'), createdAt: new Date() }),
      remove: async () => undefined,
      cleanup: async () => 0,
    };
    const drive: GoogleDriveRepositoryPort = {
      storeSubmissionFiles: async () => [
        { token: 'tok_id', driveFileId: 'drive-1' },
        { token: 'tok_cv', driveFileId: 'drive-2' },
        { token: 'tok_tit', driveFileId: 'drive-3' },
        { token: 'tok_mot', driveFileId: 'drive-4' },
      ],
    };
    const app = createApp({
      catalog,
      repository,
      formProfileRepository: profileRepo,
      temporaryFileStorage: storage,
      googleDriveRepository: drive,
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

  it('POST /api/targets/:id/submissions returns 201 with submissionId for valid submission', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-preinscription-session': 'session-test',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.submissionId).toBeDefined();
    expect(data.submissionId).toMatch(/^sub_/);
  });

  it('POST /api/targets/:id/submissions returns 409 when target is closed', async () => {
    const res = await fetch(`${baseUrl}/api/targets/mg-c8/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configRevision: 'mg-c8-v1',
        values: validPayload.values,
      }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error.code).toBe('CLOSED');
  });

  it('POST /api/targets/:id/submissions returns 409 for stale revision', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configRevision: 'stale-rev-00',
        values: validPayload.values,
      }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error.code).toBe('STALE_REVISION');
  });

  it('POST /api/targets/:id/submissions returns 400 for field validation error', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configRevision: validPayload.configRevision,
        values: {
          ...validPayload.values,
          email: 'correo-invalido',
        },
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.fieldErrors.email).toBeDefined();
  });

  it('POST /api/targets/:id/submissions returns 404 for unknown target', async () => {
    const res = await fetch(`${baseUrl}/api/targets/target-no-existe/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('POST /api/targets/:id/submissions returns 400 for malformed payload', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: 'not an object' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('INVALID_REQUEST');
  });

  it('ensures error responses never leak connection strings or secrets', async () => {
    const res = await fetch(`${baseUrl}/api/targets/davia-c11/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: 'invalid' }),
    });

    const text = await res.text();
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('password');
    expect(text).not.toContain('secret');
  });
});
