import { describe, it, expect } from 'vitest';
import { composeForm } from './form-composition.js';
import type { AcademicTarget } from '@flacso/contracts';
import {
  getDefaultProfileDefinition,
  type EffectiveProfile,
} from './form-profiles.js';

function mockEffectiveProfile(type: any): EffectiveProfile {
  return {
    profileId: `profile_${type}`,
    type,
    name: type.toUpperCase(),
    versionId: `ver_${type}_v1`,
    versionNumber: 1,
    definition: getDefaultProfileDefinition(type),
  };
}

describe('composeForm with Form Profiles', () => {
  const baseTarget: AcademicTarget = {
    id: 'davia-c11',
    kind: 'academic_offer',
    title: 'DAVIA Cohorte 11',
    offerType: 'diploma',
    offer: {
      id: 100,
      slug: 'davia',
      name: 'DAVIA',
      type: 'diploma',
      orientations: ['Educación', 'Políticas'],
      mentions: ['Tecnología', 'Gestión'],
    },
    registrationOpen: true,
    configRevision: 'wp-rev-100',
    orientations: ['Educación', 'Políticas'],
    mentions: ['Tecnología', 'Gestión'],
  };

  it('exposes the exact institutional image diffusion label and does not contain obsolete wording', () => {
    const result = composeForm(baseTarget, mockEffectiveProfile('diploma'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Form composition failed');
    const input = result.value.inputs.find((i) => i.key === 'aceptaDifusion');
    expect(input).toBeDefined();
    expect(input?.label).toBe('¿Autorizás la difusión de imagen por parte de FLACSO Uruguay?');
    expect(input?.label).not.toContain('nombre y foto');
    expect(input?.spreadsheetColumn).toBe('Autoriza difusión');
  });

  it('composes forms for all five recognized types using their respective profiles', () => {
    const types = ['maestria', 'especializacion', 'diplomado', 'diploma', 'seminar'] as const;

    for (const type of types) {
      const target: AcademicTarget = {
        ...baseTarget,
        id: `target_${type}`,
        kind: type === 'seminar' ? 'seminar' : 'academic_offer',
        offerType: type,
        offer: type !== 'seminar' ? {
          id: 1,
          slug: type,
          name: type,
          type,
          orientations: ['O1'],
          mentions: ['M1'],
        } : undefined,
        seminar: type === 'seminar' ? {
          id: 2,
          slug: 'seminario',
          name: 'Seminario',
          type: 'seminar',
        } : undefined,
        orientations: type === 'seminar' ? [] : ['O1'],
        mentions: type === 'seminar' ? [] : ['M1'],
      };

      const profile = mockEffectiveProfile(type);
      const result = composeForm(target, profile);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.offerType).toBe(type);
      expect(result.value.profileVersionId).toBe(profile.versionId);
      expect(result.value.effectiveRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

      if (type === 'seminar') {
        expect(result.value.steps.length).toBe(4);
      } else {
        expect(result.value.steps.length).toBe(6);
      }
    }
  });

  it('configures 2 recommendation letters and full documentation for maestria', () => {
    const maestriaTarget: AcademicTarget = {
      ...baseTarget,
      offerType: 'maestria',
      offer: {
        id: 100,
        slug: 'maestria',
        name: 'Maestría',
        type: 'maestria',
        orientations: [],
        mentions: [],
      },
    };

    const profile = mockEffectiveProfile('maestria');
    const result = composeForm(maestriaTarget, profile);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.recommendationLettersCount).toBe(2);
    const docKeys = result.value.documents.map((d) => d.key);
    expect(docKeys).toContain('identidad');
    expect(docKeys).toContain('cv');
    expect(docKeys).toContain('titulo');
    expect(docKeys).toContain('cartaMotivacion');
    expect(docKeys).toContain('cartaRecomendacion1');
    expect(docKeys).toContain('cartaRecomendacion2');
  });

  it('rejects unsupported doctorado offer type as incompatible', () => {
    const doctoradoTarget: AcademicTarget = {
      ...baseTarget,
      offerType: 'doctorado',
      offer: {
        id: 99,
        slug: 'doctorado',
        name: 'Doctorado',
        type: 'doctorado',
        orientations: [],
        mentions: [],
      },
    };

    // No profile exists for doctorado
    const result = composeForm(doctoradoTarget, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_OFFER_TYPE');
      expect(result.error.issues).toContain('unsupported_offer_type: doctorado');
    }
  });

  describe('independent orientation and mencion conditions', () => {
    it('includes orientacion and omits mencion when only orientations are present in target', () => {
      const targetWithOrientationsOnly: AcademicTarget = {
        ...baseTarget,
        orientations: ['Educación', 'Políticas'],
        mentions: [],
      };

      const profile = mockEffectiveProfile('diploma');
      const result = composeForm(targetWithOrientationsOnly, profile);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const keys = result.value.inputs.map((i) => i.key);
      expect(keys).toContain('orientacion');
      expect(keys).not.toContain('mencion');
    });

    it('places mention in the separate orientation step when the target has mentions', () => {
      const targetWithMentionsOnly: AcademicTarget = {
        ...baseTarget,
        orientations: [],
        mentions: ['Tecnología Educativa'],
      };

      const profile = mockEffectiveProfile('diploma');
      const result = composeForm(targetWithMentionsOnly, profile);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const keys = result.value.inputs.map((i) => i.key);
      expect(keys).not.toContain('orientacion');
      expect(keys).toContain('mencion');
      expect(result.value.inputs.find((input) => input.key === 'mencion')?.stepId).toBe('orientacion');
    });

    it('omits both orientacion and mencion when both target lists are empty', () => {
      const targetWithoutEither: AcademicTarget = {
        ...baseTarget,
        orientations: [],
        mentions: [],
      };

      const profile = mockEffectiveProfile('diploma');
      const result = composeForm(targetWithoutEither, profile);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const keys = result.value.inputs.map((i) => i.key);
      expect(keys).not.toContain('orientacion');
      expect(keys).not.toContain('mencion');
    });

    it('does not compose institution or mention fields into the academic step', () => {
      const target: AcademicTarget = {
        ...baseTarget,
        orientations: [],
        mentions: ['Tecnología Educativa'],
      };
      const result = composeForm(target, mockEffectiveProfile('maestria'));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.inputs.map((input) => input.key)).not.toContain('institucion');
      expect(result.value.inputs.find((input) => input.key === 'mencion')?.stepId).toBe('orientacion');
      expect(result.value.documents.find((document) => document.key === 'titulo')?.stepId).toBe('academico');
    });
  });

  it('excludes orientacion and mencion rules for seminar targets regardless', () => {
    const seminarTarget: AcademicTarget = {
      id: 'seminar-1',
      kind: 'seminar',
      title: 'Seminario Metodología',
      offerType: 'seminar',
      seminar: {
        id: 200,
        slug: 'metodologia',
        name: 'Metodología',
        type: 'seminar',
      },
      registrationOpen: true,
      configRevision: 'rev-seminar',
      orientations: [],
      mentions: [],
    };

    const profile = mockEffectiveProfile('seminar');
    const result = composeForm(seminarTarget, profile);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.kind).toBe('seminar');
    expect(result.value.steps.length).toBe(4);
    const keys = result.value.inputs.map((i) => i.key);
    expect(keys).not.toContain('orientacion');
    expect(keys).not.toContain('mencion');
  });

  it('produces distinct effectiveRevision when configRevision or profileVersion changes', () => {
    const profileV1 = mockEffectiveProfile('diploma');
    const profileV2: EffectiveProfile = {
      ...profileV1,
      versionId: 'ver_diploma_v2',
      versionNumber: 2,
    };

    const res1 = composeForm(baseTarget, profileV1);
    const res2 = composeForm(baseTarget, profileV2);
    const res3 = composeForm({ ...baseTarget, configRevision: 'wp-rev-changed' }, profileV1);

    expect(res1.ok && res2.ok && res3.ok).toBe(true);
    if (res1.ok && res2.ok && res3.ok) {
      expect(res1.value.effectiveRevision).not.toBe(res2.value.effectiveRevision);
      expect(res1.value.effectiveRevision).not.toBe(res3.value.effectiveRevision);
    }
  });
});
