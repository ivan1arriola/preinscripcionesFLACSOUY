import { describe, it, expect } from 'vitest';
import { composeForm } from './form-composition.js';
import type { AcademicTarget } from '@flacso/contracts';
import { UNIVERSAL_INPUTS } from './form-definition.js';

describe('composeForm', () => {
  const baseTarget: AcademicTarget = {
    id: 'davia-c11',
    kind: 'academic_offer',
    title: 'DAVIA Cohorte 11',
    registrationOpen: true,
    configRevision: 'rev-1',
    form: {
      valid: true,
      inputs: [
        { key: 'documento', position: 10, required: true },
        { key: 'orientacion', position: 20, required: true },
        { key: 'mencion', position: 30, required: false },
      ],
      issues: [],
    },
    orientations: [{ id: 'educacion', name: 'Educación', mentions: [] }],
    mentions: [{ id: 'tec-edu', name: 'Tecnología Educativa' }],
  };

  it('composes universal inputs with configured inputs sorted by position', () => {
    const result = composeForm(baseTarget);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const keys = result.value.inputs.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(UNIVERSAL_INPUTS.map((input) => input.key)));
    expect(keys).toContain('nombre1');
    expect(keys).toContain('nombre2');
    expect(keys).toContain('apellido1');
    expect(keys).toContain('apellido2');
    expect(keys).toContain('email');
    expect(keys).toContain('celular');
    expect(keys).toContain('documento');
    expect(keys).toContain('orientacion');
    expect(keys).toContain('mencion');

    // Check positions are ascending
    const inputs = result.value.inputs;
    for (let i = 0; i < inputs.length - 1; i++) {
      const posA = inputs[i]?.position ?? 0;
      const posB = inputs[i + 1]?.position ?? 0;
      expect(posA).toBeLessThanOrEqual(posB);
    }
  });

  it('rejects unknown configured input key with an incompatibility error', () => {
    const invalidTarget: AcademicTarget = {
      ...baseTarget,
      form: {
        valid: true,
        inputs: [{ key: 'experiencia_profesional_desconocida', position: 10 }],
        issues: [],
      },
    };

    const result = composeForm(invalidTarget);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toContain(
        'Clave de input no soportada: experiencia_profesional_desconocida'
      );
    }
  });

  it('rejects duplicate input keys', () => {
    const duplicateTarget: AcademicTarget = {
      ...baseTarget,
      form: {
        valid: true,
        inputs: [
          { key: 'documento', position: 10 },
          { key: 'documento', position: 20 },
        ],
        issues: [],
      },
    };

    const result = composeForm(duplicateTarget);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toContain('Clave de input duplicada: documento');
    }
  });

  it('respects required overrides from target configuration', () => {
    const overrideTarget: AcademicTarget = {
      ...baseTarget,
      form: {
        valid: true,
        inputs: [{ key: 'institucion', position: 10, required: true }],
        issues: [],
      },
    };

    const result = composeForm(overrideTarget);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const institucion = result.value.inputs.find((i) => i.key === 'institucion');
    expect(institucion?.required).toBe(true);
  });

  it('keeps orientation and mention independent', () => {
    const result = composeForm({
      ...baseTarget,
      form: {
        valid: true,
        inputs: [
          { key: 'orientacion', position: 10, required: false },
          { key: 'mencion', position: 20, required: true },
        ],
        issues: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inputs.find((input) => input.key === 'orientacion')?.required).toBe(false);
    expect(result.value.inputs.find((input) => input.key === 'mencion')?.required).toBe(true);
    expect(result.value.mentions).toEqual([{ id: 'tec-edu', name: 'Tecnología Educativa' }]);
  });

  it('does not expose orientation or mention for seminars', () => {
    const result = composeForm({
      ...baseTarget,
      kind: 'seminar',
      form: {
        valid: true,
        inputs: [
          { key: 'orientacion', position: 10, required: true },
          { key: 'mencion', position: 20, required: true },
        ],
        issues: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inputs.map((input) => input.key)).not.toEqual(
      expect.arrayContaining(['orientacion', 'mencion'])
    );
    expect(result.value.orientations).toEqual([]);
    expect(result.value.mentions).toEqual([]);
  });
});
