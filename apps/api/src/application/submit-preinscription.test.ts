import { describe, it, expect } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import { FixtureAcademicCatalog } from '../infrastructure/fixtures/fixture-academic-catalog.js';
import { InMemorySubmissionRepository } from '../infrastructure/database/in-memory-submission-repository.js';
import { getTargetForm } from './get-target-form.js';
import { submitPreinscription } from './submit-preinscription.js';

describe('submitPreinscription Use Case', () => {
  const catalog = new FixtureAcademicCatalog();

  async function currentRevision(targetId = 'davia-c11') {
    const result = await getTargetForm(catalog, targetId);
    if (!result.ok) throw new Error(result.message);
    return result.form.effectiveRevision;
  }

  const baseFiles = [
    { fieldKey: 'identidad', token: 'tok_id', originalName: 'cedula.pdf', mimeType: 'application/pdf', size: 1024 },
    { fieldKey: 'cv', token: 'tok_cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 1024 },
    { fieldKey: 'titulo', token: 'tok_tit', originalName: 'titulo.pdf', mimeType: 'application/pdf', size: 1024 },
    { fieldKey: 'cartaMotivacion', token: 'tok_mot', originalName: 'carta.pdf', mimeType: 'application/pdf', size: 1024 },
  ];

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
    ciudadResidencia: 'Montevideo',
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
    sinTituloActual: 'No',
    tituloDenominacion: 'Licenciada en Ciencias de la Educación',
    cartaRecomendacion1Pendiente: 'No',
    cartaRecomendacion2Pendiente: 'No',
    institucion: 'Universidad de la República',
  };

  it('successfully persists a valid submission for an open target without depending on field order', async () => {
    const repo = new InMemorySubmissionRepository();

    // Pass values in arbitrary/reversed order
    const reorderedValues: Record<string, string> = Object.fromEntries(
      Object.entries(validValues).reverse()
    );

    const result = await submitPreinscription(catalog, repo, {
      targetId: 'davia-c11',
      configRevision: await currentRevision(),
      values: reorderedValues,
      files: baseFiles,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rev = await currentRevision();
    expect(result.submissionId).toMatch(/^sub_/);
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]?.targetId).toBe('davia-c11');
    expect(repo.submissions[0]?.configRevision).toBe(rev);
    expect(repo.submissions[0]?.profileVersionId).toBe('canonical-v1');
    expect(repo.submissions[0]?.profileSnapshot).toBeDefined();
    expect(repo.submissions[0]?.values.nombre1).toBe('Valeria');
    expect(repo.submissions[0]?.values.documento).toBe('3.456.789-4');
    expect(repo.submissions[0]?.values.celular).toBe('+59899123456');
    expect(repo.submissions[0]?.values.orientacion).toBe('Educación');
    expect(repo.submissions[0]?.values.mencion).toBe('Tecnología Educativa');
    expect(result.catalogValidation).toBe('live');
  });

  describe('when WordPress does not respond', () => {
    function unavailableCatalog(cached: AcademicTarget[] | null): AcademicCatalog {
      return {
        listTargets: () => catalog.listTargets(),
        getTarget: (id) => catalog.getTarget(id),
        revalidateTarget: async () => { throw new Error('WordPress caído'); },
        revalidateTargets: async () => { throw new Error('WordPress caído'); },
        listCachedTargets: async () => cached,
      };
    }

    it('accepts the submission against the recent cached catalog and marks it', async () => {
      const repo = new InMemorySubmissionRepository();
      const result = await submitPreinscription(unavailableCatalog(await catalog.listTargets()), repo, {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: validValues,
        files: baseFiles,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.catalogValidation).toBe('cached');
      expect(repo.submissions[0]?.catalogValidation).toBe('cached');
    });

    it('returns CATALOG_UNAVAILABLE without persisting when there is no recent cache', async () => {
      const repo = new InMemorySubmissionRepository();
      const result = await submitPreinscription(unavailableCatalog(null), repo, {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: validValues,
        files: baseFiles,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('CATALOG_UNAVAILABLE');
      expect(repo.submissions).toHaveLength(0);
    });
  });

  it('rejects a submission when WordPress target revision changes (stale form revision) but keeps prior submissions unchanged', async () => {
    const repo = new InMemorySubmissionRepository();
    const oldRevision = await currentRevision();

    // First submission with current revision
    const firstResult = await submitPreinscription(catalog, repo, {
      targetId: 'davia-c11',
      configRevision: oldRevision,
      values: validValues,
      files: baseFiles,
    });
    expect(firstResult.ok).toBe(true);
    expect(repo.submissions[0]?.profileVersionId).toBe('canonical-v1');

    // Second submission using outdated revision must be rejected
    const secondResult = await submitPreinscription(catalog, repo, {
      targetId: 'davia-c11',
      configRevision: 'outdated-wp-rev:canonical-v1',
      values: validValues,
      files: baseFiles,
    });
    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) return;
    expect(secondResult.code).toBe('STALE_REVISION');

    // Prior submission remains intact with its original snapshot
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]?.profileVersionId).toBe('canonical-v1');
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

  describe('seminar submission availability checks', () => {
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

      const result = await submitPreinscription(mockCatalog, repo, {
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
        getTarget: async (id: string) => targets.find((t) => t.id === id) ?? null,
        revalidateTarget: async (id: string) => targets.find((t) => t.id === id) ?? null,
        revalidateTargets: async () => targets,
      };

      const result = await submitPreinscription(mockCatalog, repo, {
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

      const result = await submitPreinscription(mockCatalog, repo, {
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
        getTarget: async (id: string) => targets.find((t) => t.id === id) ?? null,
        revalidateTarget: async (id: string) => targets.find((t) => t.id === id) ?? null,
        revalidateTargets: async () => targets,
      };

      const formRes = await getTargetForm(mockCatalog, 'sem-current');
      if (!formRes.ok) throw new Error(formRes.message);

      const result = await submitPreinscription(mockCatalog, repo, {
        targetId: 'sem-current',
        configRevision: formRes.form.effectiveRevision,
        values: { ...validValues, orientacion: '', mencion: '' },
        files: baseFiles,
      });

      expect(result.ok).toBe(true);
      expect(repo.submissions).toHaveLength(1);
    });
  });

  describe('maestria recommendation letters requirement', () => {
    const maestriaTarget: AcademicTarget = {
      id: 'maestria-test',
      kind: 'academic_offer',
      title: 'Maestría en Políticas Públicas',
      offerType: 'maestria',
      registrationOpen: true,
      configRevision: 'wp-rev-m1',
      orientations: [],
      mentions: [],
    };

    const mockCatalog: AcademicCatalog = {
      listTargets: async () => [maestriaTarget],
      getTarget: async () => maestriaTarget,
      revalidateTarget: async () => maestriaTarget,
      revalidateTargets: async () => [maestriaTarget],
    };

    it('rejects maestria submission when recommendation letters are missing', async () => {
      const repo = new InMemorySubmissionRepository();
      const formRes = await getTargetForm(mockCatalog, 'maestria-test');
      if (!formRes.ok) throw new Error(formRes.message);

      const result = await submitPreinscription(mockCatalog, repo, {
        targetId: 'maestria-test',
        configRevision: formRes.form.effectiveRevision,
        values: { ...validValues, orientacion: '', mencion: '' },
        files: baseFiles, // missing cartaRecomendacion1 and 2
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VALIDATION_ERROR');
        expect(result.fieldErrors?.cartaRecomendacion1).toBeDefined();
      }
      expect(repo.submissions).toHaveLength(0);
    });

    it('persists maestria submission when both recommendation letters are provided', async () => {
      const repo = new InMemorySubmissionRepository();
      const formRes = await getTargetForm(mockCatalog, 'maestria-test');
      if (!formRes.ok) throw new Error(formRes.message);

      const maestriaFiles = [
        ...baseFiles,
        { fieldKey: 'cartaRecomendacion1', token: 'tok_rec1', originalName: 'rec1.pdf', mimeType: 'application/pdf', size: 1024 },
        { fieldKey: 'cartaRecomendacion2', token: 'tok_rec2', originalName: 'rec2.pdf', mimeType: 'application/pdf', size: 1024 },
      ];

      const result = await submitPreinscription(mockCatalog, repo, {
        targetId: 'maestria-test',
        configRevision: formRes.form.effectiveRevision,
        values: { ...validValues, orientacion: '', mencion: '' },
        files: maestriaFiles,
      });

      expect(result.ok).toBe(true);
      expect(repo.submissions).toHaveLength(1);
      expect(repo.submissions[0]?.profileVersionId).toBe('canonical-v1');
    });
  });
});
