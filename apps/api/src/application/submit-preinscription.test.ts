import { describe, it, expect } from 'vitest';
import { FixtureAcademicCatalog } from '../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../infrastructure/database/in-memory-submission-repository.js';
import { submitPreinscription } from './submit-preinscription.js';

describe('submitPreinscription Use Case', () => {
  const catalog = new FixtureAcademicCatalog();

  const validValues = {
    nombre: 'Valeria',
    apellido: 'González',
    email: 'valeria@example.com',
    telefono: '098765432',
    documento: '4.567.890-1',
    fechaNacimiento: '1990-05-15',
    orientacion: 'educacion',
    mencion: 'tec-edu',
    titulo: 'Licenciada en Ciencias de la Educación',
  };

  it('successfully persists a valid submission for an open target without depending on field order', async () => {
    const repo = new InMemorySubmissionRepository();

    // Pass values in arbitrary/reversed order
    const reorderedValues: Record<string, string> = {
      titulo: validValues.titulo,
      email: validValues.email,
      nombre: validValues.nombre,
      mencion: validValues.mencion,
      documento: validValues.documento,
      apellido: validValues.apellido,
      orientacion: validValues.orientacion,
      fechaNacimiento: validValues.fechaNacimiento,
      telefono: validValues.telefono,
    };

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
    expect(repo.submissions[0]?.values.nombre).toBe('Valeria');
  });

  it('rejects a closed target and does not persist', async () => {
    const repo = new InMemorySubmissionRepository();

    const result = await submitPreinscription(catalog, repo, {
      targetId: 'mg-c8', // closed in fixture
      configRevision: 'mg-c8-v1',
      values: {
        nombre: 'Valeria',
        apellido: 'González',
        email: 'valeria@example.com',
        documento: '4.567.890-1',
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
