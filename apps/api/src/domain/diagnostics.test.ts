import { describe, it, expect } from 'vitest';
import { diagnoseTarget } from './diagnostics.js';
import type { AcademicTarget } from '@flacso/contracts';

describe('diagnoseTarget', () => {
  const operationalTarget: AcademicTarget = {
    id: 'davia-c11',
    kind: 'academic_offer',
    title: 'DAVIA Cohorte 11',
    registrationOpen: true,
    configRevision: 'rev-1',
    form: {
      valid: true,
      inputs: [{ key: 'documento', position: 10, required: true }],
      issues: [],
    },
    orientations: [],
  };

  it('diagnoses an open target with supported inputs as operational', () => {
    const diagnostic = diagnoseTarget(operationalTarget);
    expect(diagnostic.status).toBe('operational');
    expect(diagnostic.issues).toHaveLength(0);
  });

  it('diagnoses a closed target with supported inputs as closed', () => {
    const closedTarget: AcademicTarget = {
      ...operationalTarget,
      registrationOpen: false,
    };
    const diagnostic = diagnoseTarget(closedTarget);
    expect(diagnostic.status).toBe('closed');
  });

  it('diagnoses a target with unsupported input key as incompatible', () => {
    const incompatibleTarget: AcademicTarget = {
      ...operationalTarget,
      form: {
        valid: true,
        inputs: [{ key: 'campo_inexistente', position: 10 }],
        issues: [],
      },
    };
    const diagnostic = diagnoseTarget(incompatibleTarget);
    expect(diagnostic.status).toBe('incompatible');
    expect(diagnostic.issues.length).toBeGreaterThan(0);
    expect(diagnostic.issues[0]).toContain('campo_inexistente');
  });

  it('diagnoses a target with form.valid === false as incompatible', () => {
    const invalidFormTarget: AcademicTarget = {
      ...operationalTarget,
      form: {
        valid: false,
        inputs: [],
        issues: ['Configuración corrupta en WordPress'],
      },
    };
    const diagnostic = diagnoseTarget(invalidFormTarget);
    expect(diagnostic.status).toBe('incompatible');
    expect(diagnostic.issues).toContain('Configuración corrupta en WordPress');
  });
});
