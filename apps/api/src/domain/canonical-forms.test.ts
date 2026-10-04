import { describe, it, expect } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import {
  getCanonicalFormDefinition,
  CANONICAL_SCHEMA_VERSION,
  CANONICAL_STEPS,
} from './canonical-forms.js';

describe('Canonical Forms Specification', () => {
  const baseTarget: AcademicTarget = {
    id: 'diploma-davia',
    kind: 'academic_offer',
    title: 'Diploma en DAVIA',
    offerType: 'diploma',
    registrationOpen: true,
    configRevision: 'wp-rev-100',
    orientations: [],
    mentions: [],
  };

  it('defines the canonical steps including a separate orientation segment', () => {
    expect(CANONICAL_STEPS).toHaveLength(6);
    expect(CANONICAL_STEPS.map((s) => s.id)).toEqual([
      'personal',
      'contacto',
      'academico',
      'orientacion',
      'documentos',
      'declaracion',
    ]);
    expect(CANONICAL_STEPS.map((s) => s.title)).toEqual([
      'Datos personales y demográficos',
      'Residencia y contacto',
      'Trayectoria académica',
      'Orientación y mención',
      'Documentación requerida',
      'Convenios y declaraciones',
    ]);
  });

  it('composes standard form with canonical-v1 revision and 4 base documents for non-maestria', () => {
    const result = getCanonicalFormDefinition(baseTarget);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const form = result.value;
    expect(form.profileVersionId).toBe(CANONICAL_SCHEMA_VERSION);
    expect(form.effectiveRevision).toBe('wp-rev-100:canonical-v1');
    expect(form.steps).toHaveLength(5);

    // Documents check
    const docKeys = form.documents.map((d) => d.key);
    expect(docKeys).toEqual(['identidad', 'cv', 'titulo', 'cartaMotivacion']);
    expect(form.documents.every((d) => d.required === true)).toBe(true);
    expect(form.documents.every((d) => d.canDefer === false)).toBe(true);
    expect(form.recommendationLettersCount).toBe(0);

    // Inputs check: includes ciudadResidencia and tituloDenominacion, excludes escolaridad and full street domicilio
    const inputKeys = form.inputs.map((i) => i.key);
    expect(inputKeys).toContain('ciudadResidencia');
    expect(inputKeys).toContain('tituloDenominacion');
    expect(inputKeys).not.toContain('escolaridad');
    expect(inputKeys).not.toContain('domicilio');
  });

  it('adds 2 mandatory recommendation letters for maestria without deferral', () => {
    const maestriaTarget: AcademicTarget = {
      ...baseTarget,
      id: 'maestria-genero',
      title: 'Maestría en Género',
      offerType: 'maestria',
    };

    const result = getCanonicalFormDefinition(maestriaTarget);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const form = result.value;
    const docKeys = form.documents.map((d) => d.key);
    expect(docKeys).toEqual([
      'identidad',
      'cv',
      'titulo',
      'cartaMotivacion',
      'cartaRecomendacion1',
      'cartaRecomendacion2',
    ]);
    const rec1 = form.documents.find((d) => d.key === 'cartaRecomendacion1');
    const rec2 = form.documents.find((d) => d.key === 'cartaRecomendacion2');
    expect(rec1?.required).toBe(true);
    expect(rec1?.canDefer).toBe(false);
    expect(rec2?.required).toBe(true);
    expect(rec2?.canDefer).toBe(false);
    expect(form.recommendationLettersCount).toBe(2);

    const inputKeys = form.inputs.map((i) => i.key);
    expect(inputKeys).not.toContain('cartaRecomendacion1Pendiente');
    expect(inputKeys).not.toContain('cartaRecomendacion2Pendiente');
  });

  it('canonicalDocumentsForSeminarExcludeLetters: seminar form excludes motivation and recommendations', () => {
    const seminarTarget: AcademicTarget = {
      id: 'seminar-test',
      kind: 'seminar',
      title: 'Seminario Internacional',
      registrationOpen: true,
      configRevision: 'sem-100',
      orientations: [],
      mentions: [],
    };

    const result = getCanonicalFormDefinition(seminarTarget);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const form = result.value;
    const docKeys = form.documents.map((d) => d.key);
    expect(docKeys).toEqual(['identidad', 'cv', 'titulo']);
    expect(docKeys).not.toContain('cartaMotivacion');
    expect(docKeys).not.toContain('cartaRecomendacion1');
    expect(docKeys).not.toContain('cartaRecomendacion2');
    expect(form.recommendationLettersCount).toBe(0);
  });

  it('includes orientations and mentions only when present in WordPress target', () => {
    const targetWithOptions: AcademicTarget = {
      ...baseTarget,
      orientations: ['Educación', 'Políticas'],
      mentions: ['Gestión'],
    };

    const result = getCanonicalFormDefinition(targetWithOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const inputKeys = result.value.inputs.map((i) => i.key);
    expect(inputKeys).toContain('orientacion');
    expect(inputKeys).toContain('mencion');

    const resultWithout = getCanonicalFormDefinition(baseTarget);
    if (!resultWithout.ok) return;
    const inputKeysWithout = resultWithout.value.inputs.map((i) => i.key);
    expect(inputKeysWithout).not.toContain('orientacion');
    expect(inputKeysWithout).not.toContain('mencion');
  });

  it('rejects unsupported offer types such as doctorado', () => {
    const doctoradoTarget: AcademicTarget = {
      ...baseTarget,
      offerType: 'doctorado',
    };
    const result = getCanonicalFormDefinition(doctoradoTarget);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_OFFER_TYPE');
    }
  });
});
