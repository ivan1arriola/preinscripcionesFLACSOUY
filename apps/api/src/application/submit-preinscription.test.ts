import { describe, it, expect } from 'vitest';
import { FixtureAcademicCatalog } from '../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../infrastructure/database/in-memory-submission-repository.js';
import { submitPreinscription } from './submit-preinscription.js';

describe('submitPreinscription Use Case', () => {
  const catalog = new FixtureAcademicCatalog();

  const validValues = {
    nombre1: 'Valeria',
    nombre2: '',
    apellido1: 'González',
    apellido2: '',
    email: 'valeria@example.com',
    fechaNacimiento: '1990-05-15',
    tipoDocumento: 'cedula_uruguaya',
    documento: '34567894',
    paisEmisorDocumento: 'Uruguay',
    genero: 'Mujer',
    etnia: 'No declara',
    celular: '099123456',
    domicilio: 'Montevideo',
    ocupacion: 'Docente',
    paisNacimiento: 'Uruguay',
    paisResidencia: 'Uruguay',
    tieneConvenio: 'No',
    fuente: 'Web',
    aceptaDifusion: 'No',
    estudios: 'Licenciatura',
    posgradoFlacso: 'No',
    posgradoCual: '',
    orientacion: 'educacion',
    mencion: 'tec-edu',
    titulo: 'Licenciada en Ciencias de la Educación',
  };

  it('successfully persists a valid submission for an open target without depending on field order', async () => {
    const repo = new InMemorySubmissionRepository();

    // Pass values in arbitrary/reversed order
    const reorderedValues: Record<string, string> = Object.fromEntries(
      Object.entries(validValues).reverse()
    );

    const result = await submitPreinscription(catalog, repo, {
      targetId: 'davia-c11',
      configRevision: 'davia-c11-v1',
      values: reorderedValues,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.submissionId).toMatch(/^sub_/);
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]?.targetId).toBe('davia-c11');
    expect(repo.submissions[0]?.configRevision).toBe('davia-c11-v1');
    expect(repo.submissions[0]?.values.nombre1).toBe('Valeria');
    expect(repo.submissions[0]?.values.documento).toBe('3.456.789-4');
    expect(repo.submissions[0]?.values.celular).toBe('+59899123456');
  });

  it('rejects a closed target and does not persist', async () => {
    const repo = new InMemorySubmissionRepository();

    const result = await submitPreinscription(catalog, repo, {
      targetId: 'mg-c8', // closed in fixture
      configRevision: 'mg-c8-v1',
      values: {
        nombre1: 'Valeria',
        apellido1: 'González',
        email: 'valeria@example.com',
        fechaNacimiento: '1990-05-15',
        tipoDocumento: 'cedula_uruguaya',
        documento: '4.567.890-1',
        paisEmisorDocumento: 'Uruguay',
        genero: 'Mujer',
        etnia: 'No declara',
        celular: '098765432',
        domicilio: 'Montevideo',
        ocupacion: 'Docente',
        paisNacimiento: 'Uruguay',
        paisResidencia: 'Uruguay',
        tieneConvenio: 'No',
        fuente: 'Web',
        aceptaDifusion: 'No',
        estudios: 'Licenciatura',
        posgradoFlacso: 'No',
        posgradoCual: '',
        titulo: 'Licenciada',
        escolaridad: 'Escolaridad adjunta',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('CLOSED');
    expect(repo.submissions).toHaveLength(0);
  });

  it('rejects a submission with an outdated configRevision (stale form)', async () => {
    const repo = new InMemorySubmissionRepository();

    const result = await submitPreinscription(catalog, repo, {
      targetId: 'davia-c11',
      configRevision: 'outdated-revision-99',
      values: validValues,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('STALE_REVISION');
    expect(repo.submissions).toHaveLength(0);
  });

  it('rejects invalid field values and does not persist', async () => {
    const repo = new InMemorySubmissionRepository();

    const invalidValues = {
      ...validValues,
      email: 'not-an-email',
      mencion: 'mencion-inexistente',
    };

    const result = await submitPreinscription(catalog, repo, {
      targetId: 'davia-c11',
      configRevision: 'davia-c11-v1',
      values: invalidValues,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.fieldErrors?.email).toBeDefined();
    expect(result.fieldErrors?.mencion).toBeDefined();
    expect(repo.submissions).toHaveLength(0);
  });

  it('returns NOT_FOUND for unknown targetId', async () => {
    const repo = new InMemorySubmissionRepository();

    const result = await submitPreinscription(catalog, repo, {
      targetId: 'target-fantasma',
      configRevision: 'v1',
      values: validValues,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('NOT_FOUND');
    expect(repo.submissions).toHaveLength(0);
  });
});
