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
    aceptaComunicaciones: 'Si',
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
    expect(repo.submissions[0]?.profileVersionId).toBe('canonical-v2');
    expect(repo.submissions[0]?.profileSnapshot).toBeDefined();
    expect(repo.submissions[0]?.values.nombre1).toBe('Valeria');
    expect(repo.submissions[0]?.values.documento).toBe('3.456.789-4');
    expect(repo.submissions[0]?.values.celular).toBe('+59899123456');
    expect(repo.submissions[0]?.values.orientacion).toBeUndefined();
    expect(repo.submissions[0]?.values.mencion).toBe('Tecnología Educativa');
    expect(result.catalogValidation).toBe('live');
  });

  describe('server-side hardening', () => {
    it('requires the mandatory documents even when `files` is omitted', async () => {
      const repo = new InMemorySubmissionRepository();
      const result = await submitPreinscription(catalog, repo, {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: validValues,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(['identidad', 'cv']));
      expect(repo.submissions).toHaveLength(0);
    });

    it('drops keys that the form does not define', async () => {
      const repo = new InMemorySubmissionRepository();
      const result = await submitPreinscription(catalog, repo, {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: { ...validValues, claveInventada: 'x', __proto_extra: 'y' },
        files: baseFiles,
      });

      expect(result.ok).toBe(true);
      expect(repo.submissions[0]?.values.claveInventada).toBeUndefined();
      expect(repo.submissions[0]?.values.__proto_extra).toBeUndefined();
    });

    it('rejects impossible birth dates and oversized texts', async () => {
      const repo = new InMemorySubmissionRepository();
      const result = await submitPreinscription(catalog, repo, {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: { ...validValues, fechaNacimiento: '1990-02-31', estudios: 'x'.repeat(5001) },
        files: baseFiles,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(['fechaNacimiento', 'estudios']));
    });

    it('requires the communications consent question and only syncs Mautic when it is accepted', async () => {
      const missing = await submitPreinscription(catalog, new InMemorySubmissionRepository(), {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: { ...validValues, aceptaComunicaciones: '' },
        files: baseFiles,
      }, { isMauticContactSyncEnabled: async () => true });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(Object.keys(missing.fieldErrors ?? {})).toContain('aceptaComunicaciones');

      const declined = new InMemorySubmissionRepository();
      const declinedResult = await submitPreinscription(catalog, declined, {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: { ...validValues, aceptaComunicaciones: 'No' },
        files: baseFiles,
      }, { isMauticContactSyncEnabled: async () => true });
      expect(declinedResult.ok).toBe(true);
      expect(declined.submissions[0]?.mauticContact).toBeNull();
    });

    it('reports when the submission already existed for the same client id', async () => {
      const repo = new InMemorySubmissionRepository();
      const command = {
        clientSubmissionId: 'client-1',
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: validValues,
        files: baseFiles,
      };
      const first = await submitPreinscription(catalog, repo, command);
      const second = await submitPreinscription(catalog, repo, command);

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.existing).toBe(false);
      expect(second.existing).toBe(true);
      expect(second.submissionId).toBe(first.submissionId);
    });
  });

  describe('Mautic contact sync', () => {
    async function submitWith(isMauticContactSyncEnabled?: () => Promise<boolean>) {
      const repo = new InMemorySubmissionRepository();
      const result = await submitPreinscription(catalog, repo, {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values: validValues,
        files: baseFiles,
      }, { isMauticContactSyncEnabled });
      return { repo, result };
    }

    it('enqueues the applicant contact with stable profile and tags when enabled', async () => {
      const { repo, result } = await submitWith(async () => true);
      expect(result.ok).toBe(true);
      expect(repo.submissions[0]?.mauticContact).toMatchObject({
        email: 'valeria@example.com',
        fields: { firstname: 'Valeria', lastname: 'González', flacso_origen: 'preinscripciones' },
      });
      expect(repo.submissions[0]?.mauticContact?.tags).toContain('origen-preinscripciones');
      expect(JSON.stringify(repo.submissions[0]?.mauticContact)).not.toContain('3.456.789-4');
    });

    it('does not enqueue anything when disabled', async () => {
      const { repo } = await submitWith(async () => false);
      expect(repo.submissions[0]?.mauticContact).toBeNull();
    });

    it('still accepts the submission if the Mautic setting cannot be read', async () => {
      const { repo, result } = await submitWith(async () => { throw new Error('clave de cifrado ausente'); });
      expect(result.ok).toBe(true);
      expect(repo.submissions[0]?.mauticContact).toBeNull();
    });
  });

  describe('Mautic enrollment notice', () => {
    async function submitWith(isMauticEnrollmentNotifyEnabled?: () => Promise<boolean>, values = validValues) {
      const repo = new InMemorySubmissionRepository();
      const result = await submitPreinscription(catalog, repo, {
        targetId: 'davia-c11',
        configRevision: await currentRevision(),
        values,
        files: baseFiles,
      }, { isMauticEnrollmentNotifyEnabled });
      return { repo, result };
    }

    it('enqueues the email and the WordPress offer when enabled', async () => {
      const { repo, result } = await submitWith(async () => true);
      expect(result.ok).toBe(true);
      const notice = repo.submissions[0]?.mauticEnrollment;
      expect(notice?.email).toBe('valeria@example.com');
      expect(Number.isInteger(notice?.offerWpId)).toBe(true);
      expect(Object.keys(notice ?? {}).sort()).toEqual(['email', 'offerWpId']);
    });

    it('enqueues it even when the applicant declines communications', async () => {
      const { repo } = await submitWith(async () => true, { ...validValues, aceptaComunicaciones: 'No' });
      expect(repo.submissions[0]?.mauticContact ?? null).toBeNull();
      expect(repo.submissions[0]?.mauticEnrollment?.email).toBe('valeria@example.com');
    });

    it('does not enqueue anything when disabled or unreadable', async () => {
      expect((await submitWith(async () => false)).repo.submissions[0]?.mauticEnrollment).toBeNull();
      const unreadable = await submitWith(async () => { throw new Error('clave de cifrado ausente'); });
      expect(unreadable.result.ok).toBe(true);
      expect(unreadable.repo.submissions[0]?.mauticEnrollment).toBeNull();
    });
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
    expect(repo.submissions[0]?.profileVersionId).toBe('canonical-v2');

    // Second submission using outdated revision must be rejected
    const secondResult = await submitPreinscription(catalog, repo, {
      targetId: 'davia-c11',
      configRevision: 'outdated-wp-rev:canonical-v2',
      values: validValues,
      files: baseFiles,
    });
    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) return;
    expect(secondResult.code).toBe('STALE_REVISION');

    // Prior submission remains intact with its original snapshot
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]?.profileVersionId).toBe('canonical-v2');
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
        aceptaComunicaciones: 'Si',
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
      expect(repo.submissions[0]?.profileVersionId).toBe('canonical-v2');
    });
  });
});
