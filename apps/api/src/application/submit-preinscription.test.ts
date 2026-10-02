import { describe, it, expect } from 'vitest';
import { FixtureAcademicCatalog } from '../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../infrastructure/database/in-memory-submission-repository.js';
import { MemoryFormProfileRepository } from '../infrastructure/fixtures/memory-form-profile-repository.js';
import { getDefaultProfileDefinition } from '../domain/form-profiles.js';
import { getTargetForm } from './get-target-form.js';
import { submitPreinscription } from './submit-preinscription.js';

describe('submitPreinscription Use Case', () => {
  const catalog = new FixtureAcademicCatalog();
  const profileRepo = new MemoryFormProfileRepository({
    diploma: { ...getDefaultProfileDefinition('diploma'), documents: [] },
  });

  async function currentRevision(targetId = 'davia-c11') {
    const result = await getTargetForm(catalog, profileRepo, targetId);
    if (!result.ok) throw new Error(result.message);
    return result.form.effectiveRevision;
  }

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
    orientacion: 'Educación',
    mencion: 'Tecnología Educativa',
    titulo: 'Licenciada en Ciencias de la Educación',
    escolaridad: 'Escolaridad completa',
    institucion: 'Universidad de la República',
  };

  it('successfully persists a valid submission for an open target without depending on field order', async () => {
    const repo = new InMemorySubmissionRepository();

    // Pass values in arbitrary/reversed order
    const reorderedValues: Record<string, string> = Object.fromEntries(
      Object.entries(validValues).reverse()
    );

    const result = await submitPreinscription(catalog, repo, profileRepo, {
      targetId: 'davia-c11',
      configRevision: await currentRevision(),
      values: reorderedValues,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rev = await currentRevision();
    expect(result.submissionId).toMatch(/^sub_/);
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]?.targetId).toBe('davia-c11');
    expect(repo.submissions[0]?.configRevision).toBe(rev);
    expect(repo.submissions[0]?.profileVersionId).toBe('ver_diploma_v1');
    expect(repo.submissions[0]?.profileSnapshot).toBeDefined();
    expect(repo.submissions[0]?.values.nombre1).toBe('Valeria');
    expect(repo.submissions[0]?.values.documento).toBe('3.456.789-4');
    expect(repo.submissions[0]?.values.celular).toBe('+59899123456');
    expect(repo.submissions[0]?.values.orientacion).toBe('Educación');
    expect(repo.submissions[0]?.values.mencion).toBe('Tecnología Educativa');
  });

  it('rejects a submission when the active profile changes (stale form revision) but keeps prior submissions unchanged', async () => {
    const repo = new InMemorySubmissionRepository();
    const oldRevision = await currentRevision();

    // First submission on v1
    const firstResult = await submitPreinscription(catalog, repo, profileRepo, {
      targetId: 'davia-c11',
      configRevision: oldRevision,
      values: validValues,
    });
    expect(firstResult.ok).toBe(true);
    expect(repo.submissions[0]?.profileVersionId).toBe('ver_diploma_v1');

    // Admin adds and activates a new profile version v2
    const v2 = await profileRepo.createVersion(
      {
        type: 'diploma',
        definition: { ...getDefaultProfileDefinition('diploma'), documents: [] },
      },
      'admin@flacso.edu.uy'
    );
    await profileRepo.activateVersion(v2.profileId, v2.id);

    // Second submission using old revision must be rejected
    const secondResult = await submitPreinscription(catalog, repo, profileRepo, {
      targetId: 'davia-c11',
      configRevision: oldRevision,
      values: validValues,
    });
    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) return;
    expect(secondResult.code).toBe('STALE_REVISION');

    // Prior submission remains intact with its original v1 snapshot
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]?.profileVersionId).toBe('ver_diploma_v1');
  });

  it('rejects a closed target and does not persist', async () => {
    const repo = new InMemorySubmissionRepository();

    const result = await submitPreinscription(catalog, repo, profileRepo, {
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

    const result = await submitPreinscription(catalog, repo, profileRepo, {
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

    const result = await submitPreinscription(catalog, repo, profileRepo, {
      targetId: 'davia-c11',
      configRevision: await currentRevision(),
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

    const result = await submitPreinscription(catalog, repo, profileRepo, {
      targetId: 'target-fantasma',
      configRevision: 'v1',
      values: validValues,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('NOT_FOUND');
    expect(repo.submissions).toHaveLength(0);
  });

  describe('seminar submission availability checks', () => {
    const seminarProfileRepo = new MemoryFormProfileRepository({
      seminar: { ...getDefaultProfileDefinition('seminar'), documents: [] },
    });

    const createSeminarTarget = (id: string, editionId: number, open: boolean, availability?: 'open' | 'closed' | 'conflict'): AcademicTarget => ({
      id,
      kind: 'seminar',
      title: `Seminario Test Edición ${editionId}`,
      registrationOpen: open,
      registrationAvailability: availability,
      configRevision: 'rev-sem',
      wordpress: { seminarId: 88, editionId },
      seminar: { id: 88, slug: 'sem-test', name: 'Seminario Test', type: 'seminar' },
      orientations: [],
      mentions: [],
      urls: { legacyRegistration: 'https://flacso.edu.uy/seminario/test/' },
    });

    it('rejects submission for closed seminar edition', async () => {
      const repo = new InMemorySubmissionRepository();
      const mockCatalog: AcademicCatalog = {
        listTargets: async () => [createSeminarTarget('sem-closed', 1, false, 'closed')],
        getTarget: async () => createSeminarTarget('sem-closed', 1, false, 'closed'),
        revalidateTarget: async () => createSeminarTarget('sem-closed', 1, false, 'closed'),
        revalidateTargets: async () => [createSeminarTarget('sem-closed', 1, false, 'closed')],
      };

      const result = await submitPreinscription(mockCatalog, repo, seminarProfileRepo, {
        targetId: 'sem-closed',
        configRevision: 'rev-sem',
        values: validValues,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CLOSED');
      }
      expect(repo.submissions).toHaveLength(0);
    });

    it('rejects submission for seminar edition with conflict (multiple open)', async () => {
      const repo = new InMemorySubmissionRepository();
      const targets = [
        createSeminarTarget('sem-open-1', 1, true, 'open'),
        createSeminarTarget('sem-open-2', 2, true, 'open'),
      ];
      const mockCatalog: AcademicCatalog = {
        listTargets: async () => targets,
        getTarget: async (id) => targets.find((t) => t.id === id) ?? null,
        revalidateTarget: async (id) => targets.find((t) => t.id === id) ?? null,
        revalidateTargets: async () => targets,
      };

      const result = await submitPreinscription(mockCatalog, repo, seminarProfileRepo, {
        targetId: 'sem-open-1',
        configRevision: 'rev-sem',
        values: validValues,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CLOSED');
      }
      expect(repo.submissions).toHaveLength(0);
    });

    it('rejects submission if edition closed between form load and submit', async () => {
      const repo = new InMemorySubmissionRepository();
      let isClosed = false;

      const mockCatalog: AcademicCatalog = {
        listTargets: async () => [createSeminarTarget('sem-dyn', 1, !isClosed, isClosed ? 'closed' : 'open')],
        getTarget: async () => createSeminarTarget('sem-dyn', 1, true, 'open'),
        revalidateTarget: async () => {
          isClosed = true;
          return createSeminarTarget('sem-dyn', 1, false, 'closed');
        },
        revalidateTargets: async () => [createSeminarTarget('sem-dyn', 1, false, 'closed')],
      };

      const result = await submitPreinscription(mockCatalog, repo, seminarProfileRepo, {
        targetId: 'sem-dyn',
        configRevision: 'rev-sem',
        values: validValues,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CLOSED');
      }
      expect(repo.submissions).toHaveLength(0);
    });

    it('persists submission for unique open seminar edition', async () => {
      const repo = new InMemorySubmissionRepository();
      const targets = [
        createSeminarTarget('sem-old', 1, false, 'closed'),
        createSeminarTarget('sem-current', 2, true, 'open'),
      ];
      const mockCatalog: AcademicCatalog = {
        listTargets: async () => targets,
        getTarget: async (id) => targets.find((t) => t.id === id) ?? null,
        revalidateTarget: async (id) => targets.find((t) => t.id === id) ?? null,
        revalidateTargets: async () => targets,
      };

      const formRes = await getTargetForm(mockCatalog, seminarProfileRepo, 'sem-current');
      if (!formRes.ok) throw new Error(formRes.message);

      const result = await submitPreinscription(mockCatalog, repo, seminarProfileRepo, {
        targetId: 'sem-current',
        configRevision: formRes.form.effectiveRevision,
        values: { ...validValues, orientacion: '', mencion: '' },
      });

      expect(result.ok).toBe(true);
      expect(repo.submissions).toHaveLength(1);
    });
  });
});
