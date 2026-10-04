import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_OFFER_TYPES,
  getDefaultProfileDefinition,
  isSupportedOfferType,
  validateProfileDefinition,
  type FormProfileDefinition,
} from './form-profiles.js';

describe('Form Profiles Domain', () => {
  it('recognizes exactly the 5 supported offer types and rejects doctorado as unsupported', () => {
    expect(SUPPORTED_OFFER_TYPES).toEqual([
      'maestria',
      'especializacion',
      'diplomado',
      'diploma',
      'seminar',
    ]);

    expect(isSupportedOfferType('maestria')).toBe(true);
    expect(isSupportedOfferType('especializacion')).toBe(true);
    expect(isSupportedOfferType('diplomado')).toBe(true);
    expect(isSupportedOfferType('diploma')).toBe(true);
    expect(isSupportedOfferType('seminar')).toBe(true);

    expect(isSupportedOfferType('doctorado')).toBe(false);
    expect(isSupportedOfferType('otro')).toBe(false);
  });

  it('provides default profile definitions conforming to the required document matrix', () => {
    // Maestría: Identidad, CV, título, carta de motivación y dos cartas de recomendación
    const maestria = getDefaultProfileDefinition('maestria');
    const maestriaDocKeys = maestria.documents.map((d) => d.key);
    expect(maestriaDocKeys).toEqual([
      'identidad',
      'cv',
      'titulo',
      'cartaMotivacion',
      'cartaRecomendacion1',
      'cartaRecomendacion2',
    ]);
    expect(maestria.recommendationLettersCount).toBe(2);
    expect(maestria.steps.length).toBe(6);

    // Especialización: Identidad, CV, título y carta de motivación
    const esp = getDefaultProfileDefinition('especializacion');
    expect(esp.documents.map((d) => d.key)).toEqual([
      'identidad',
      'cv',
      'titulo',
      'cartaMotivacion',
    ]);
    expect(esp.recommendationLettersCount).toBe(0);
    expect(esp.steps.length).toBe(6);

    // Diplomado: Identidad, CV, título y carta de motivación
    const dip = getDefaultProfileDefinition('diplomado');
    expect(dip.documents.map((d) => d.key)).toEqual([
      'identidad',
      'cv',
      'titulo',
      'cartaMotivacion',
    ]);
    expect(dip.steps.length).toBe(6);

    // Diploma: Identidad, CV y título
    const diploma = getDefaultProfileDefinition('diploma');
    expect(diploma.documents.map((d) => d.key)).toEqual([
      'identidad',
      'cv',
      'titulo',
    ]);
    expect(diploma.steps.length).toBe(6);

    // Seminario: 4 steps, no orientation or mention rules
    const seminar = getDefaultProfileDefinition('seminar');
    expect(seminar.steps.length).toBe(4);
    const fieldKeys = seminar.fields.map((f) => f.key);
    expect(fieldKeys).not.toContain('orientacion');
    expect(fieldKeys).not.toContain('mencion');
    const fieldConditions = seminar.fields.map((f) => f.condition);
    expect(fieldConditions).not.toContain('has_orientations');
    expect(fieldConditions).not.toContain('has_mentions');
  });

  it('keeps the academic step focused and places the title document there', () => {
    const profile = getDefaultProfileDefinition('maestria');

    expect(profile.fields.map((field) => field.key)).not.toContain('institucion');
    expect(profile.fields.map((field) => field.key)).not.toContain('escolaridad');
    expect(profile.fields.find((field) => field.key === 'mencion')?.stepId).toBe('orientacion');
    expect(profile.fields.find((field) => field.key === 'orientacion')?.stepId).toBe('orientacion');
    expect(profile.documents.find((document) => document.key === 'titulo')?.stepId).toBe('academico');
  });

  it('throws when requesting default profile definition for unsupported doctorado', () => {
    // @ts-expect-error testing invalid type
    expect(() => getDefaultProfileDefinition('doctorado')).toThrow(
      /unsupported profile type: doctorado/i,
    );
  });

  it('validates correct profile definitions', () => {
    for (const type of SUPPORTED_OFFER_TYPES) {
      const def = getDefaultProfileDefinition(type);
      expect(() => validateProfileDefinition(type, def)).not.toThrow();
    }
  });

  it('rejects duplicate field keys within definition', () => {
    const valid = getDefaultProfileDefinition('diploma');
    const duplicateFields: FormProfileDefinition = {
      ...valid,
      fields: [
        ...valid.fields,
        {
          key: valid.fields[0]!.key,
          stepId: valid.fields[0]!.stepId,
          order: 999,
          required: false,
          condition: 'always',
        },
      ],
    };

    expect(() => validateProfileDefinition('diploma', duplicateFields)).toThrow(
      /duplicate field key/i,
    );
  });

  it('rejects duplicate document keys within definition', () => {
    const valid = getDefaultProfileDefinition('diploma');
    const duplicateDocs: FormProfileDefinition = {
      ...valid,
      documents: [
        ...valid.documents,
        {
          key: valid.documents[0]!.key,
          stepId: valid.documents[0]!.stepId,
          order: 999,
          required: false,
          canDefer: false,
          maxFiles: 1,
        },
      ],
    };

    expect(() => validateProfileDefinition('diploma', duplicateDocs)).toThrow(
      /duplicate document key/i,
    );
  });

  it('rejects fields referencing non-existent stepId', () => {
    const valid = getDefaultProfileDefinition('diploma');
    const invalidStepField: FormProfileDefinition = {
      ...valid,
      fields: [
        ...valid.fields,
        {
          key: 'custom_field',
          stepId: 'non-existent-step',
          order: 999,
          required: false,
          condition: 'always',
        },
      ],
    };

    expect(() => validateProfileDefinition('diploma', invalidStepField)).toThrow(
      /references non-existent step/i,
    );
  });

  it('rejects seminar profiles that include orientacion, mencion, or academic conditions', () => {
    const validSeminar = getDefaultProfileDefinition('seminar');

    const invalidCondition: FormProfileDefinition = {
      ...validSeminar,
      fields: [
        ...validSeminar.fields,
        {
          key: 'extra_field',
          stepId: validSeminar.steps[0]!.id,
          order: 99,
          required: false,
          condition: 'has_orientations',
        },
      ],
    };

    expect(() => validateProfileDefinition('seminar', invalidCondition)).toThrow(
      /seminar profiles cannot contain orientation or mention rules/i,
    );

    const invalidKey: FormProfileDefinition = {
      ...validSeminar,
      fields: [
        ...validSeminar.fields,
        {
          key: 'orientacion',
          stepId: validSeminar.steps[0]!.id,
          order: 99,
          required: false,
          condition: 'always',
        },
      ],
    };

    expect(() => validateProfileDefinition('seminar', invalidKey)).toThrow(
      /seminar profiles cannot contain orientation or mention rules/i,
    );
  });
});
