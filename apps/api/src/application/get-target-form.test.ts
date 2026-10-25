import { describe, it, expect } from 'vitest';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { AcademicTarget } from '@flacso/contracts';
import { getTargetForm } from './get-target-form.js';

describe('getTargetForm Use Case', () => {
  const createMockCatalog = (targets: AcademicTarget[]): AcademicCatalog => ({
    listTargets: async () => targets,
    getTarget: async (id: string) => targets.find((t) => t.id === id) ?? null,
    revalidateTarget: async (id: string) => targets.find((t) => t.id === id) ?? null,
    revalidateTargets: async () => targets,
  });

  const baseSeminar = (id: string, editionId: number, open: boolean, availability?: 'open' | 'closed' | 'conflict'): AcademicTarget => ({
    id,
    kind: 'seminar',
    title: `Seminario Test Edición ${editionId}`,
    registrationOpen: open,
    registrationAvailability: availability,
    configRevision: 'rev-1',
    wordpress: { seminarId: 10, editionId },
    seminar: { id: 10, slug: 'sem-test', name: 'Seminario Test', type: 'seminar' },
    orientations: [],
    mentions: [],
    urls: { legacyRegistration: 'https://flacso.edu.uy/seminario/test/' },
  });

  it('rejects a closed academic offer target', async () => {
    const offer: AcademicTarget = {
      id: 'offer-closed',
      kind: 'academic_offer',
      title: 'Diploma Cerrado',
      offerType: 'diploma',
      registrationOpen: false,
      configRevision: 'rev-1',
      orientations: [],
      mentions: [],
    };
    const catalog = createMockCatalog([offer]);
    const result = await getTargetForm(catalog, 'offer-closed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CLOSED');
    }
  });

  it('rejects a closed seminar edition', async () => {
    const targets = [
      baseSeminar('sem-1', 1, false, 'closed'),
      baseSeminar('sem-2', 2, true, 'open'),
    ];
    const catalog = createMockCatalog(targets);
    const result = await getTargetForm(catalog, 'sem-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CLOSED');
    }
  });

  it('rejects an edition in conflict (multiple open editions)', async () => {
    const targets = [
      baseSeminar('sem-1', 1, true, 'open'),
      baseSeminar('sem-2', 2, true, 'open'),
    ];
    const catalog = createMockCatalog(targets);
    const result = await getTargetForm(catalog, 'sem-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CLOSED');
    }
  });

  it('allows a unique open seminar edition to compose form', async () => {
    const targets = [
      baseSeminar('sem-1', 1, false, 'closed'),
      baseSeminar('sem-2', 2, true, 'open'),
    ];
    const catalog = createMockCatalog(targets);
    const result = await getTargetForm(catalog, 'sem-2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.form.targetId).toBe('sem-2');
      expect(result.form.profileVersionId).toBe('canonical-v2');
      expect(result.form.steps).toHaveLength(5);
      expect(result.form.documents).toHaveLength(3);
    }
  });

  it('uses cached targets when WordPress revalidation times out', async () => {
    const targets = [
      baseSeminar('sem-1', 1, false, 'closed'),
      baseSeminar('sem-2', 2, true, 'open'),
    ];
    const catalog = createMockCatalog(targets);
    catalog.revalidateTargets = async () => {
      throw new Error('WordPress timeout');
    };

    const result = await getTargetForm(catalog, 'sem-2');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.form.targetId).toBe('sem-2');
  });

  it('composes canonical form for maestria with 2 recommendation letters and 6 total documents', async () => {
    const maestriaOffer: AcademicTarget = {
      id: 'maestria-test',
      kind: 'academic_offer',
      title: 'Maestría en Políticas Públicas',
      offerType: 'maestria',
      registrationOpen: true,
      configRevision: 'wp-rev-m1',
      orientations: [],
      mentions: [],
    };
    const catalog = createMockCatalog([maestriaOffer]);
    const result = await getTargetForm(catalog, 'maestria-test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.form.profileVersionId).toBe('canonical-v2');
      expect(result.form.recommendationLettersCount).toBe(2);
      expect(result.form.documents).toHaveLength(6);
      const keys = result.form.documents.map((d) => d.key);
      expect(keys).toEqual([
        'identidad',
        'cv',
        'titulo',
        'cartaMotivacion',
        'cartaRecomendacion1',
        'cartaRecomendacion2',
      ]);
    }
  });
});
