import { describe, it, expect } from 'vitest';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { AcademicTarget } from '@flacso/contracts';
import { MemoryFormProfileRepository } from '../infrastructure/fixtures/memory-form-profile-repository.js';
import { getDefaultProfileDefinition } from '../domain/form-profiles.js';
import { getTargetForm } from './get-target-form.js';

describe('getTargetForm Use Case', () => {
  const profileRepo = new MemoryFormProfileRepository({
    seminar: { ...getDefaultProfileDefinition('seminar'), documents: [] },
    diploma: { ...getDefaultProfileDefinition('diploma'), documents: [] },
  });

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
    const result = await getTargetForm(catalog, profileRepo, 'offer-closed');
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
    const result = await getTargetForm(catalog, profileRepo, 'sem-1');
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
    const result = await getTargetForm(catalog, profileRepo, 'sem-1');
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
    const result = await getTargetForm(catalog, profileRepo, 'sem-2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.form.targetId).toBe('sem-2');
    }
  });
});
