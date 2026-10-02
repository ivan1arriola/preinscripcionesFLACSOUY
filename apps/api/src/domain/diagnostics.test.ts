import { describe, it, expect } from 'vitest';
import { diagnoseTarget } from './diagnostics.js';
import type { AcademicTarget } from '@flacso/contracts';

describe('diagnoseTarget', () => {
  const operationalTarget: AcademicTarget = {
    id: 'davia-c11',
    kind: 'academic_offer',
    title: 'DAVIA Cohorte 11',
    offerType: 'diploma',
    offer: {
      id: 100,
      slug: 'davia',
      name: 'DAVIA',
      type: 'diploma',
    },
    registrationOpen: true,
    configRevision: 'rev-1',
    orientations: [],
    mentions: [],
  };

  it('diagnoses an open target with supported offer type as operational', () => {
    const diagnostic = diagnoseTarget(operationalTarget);
    expect(diagnostic.status).toBe('operational');
    expect(diagnostic.issues).toHaveLength(0);
  });

  it('diagnoses a closed target with supported offer type as closed', () => {
    const closedTarget: AcademicTarget = {
      ...operationalTarget,
      registrationOpen: false,
    };
    const diagnostic = diagnoseTarget(closedTarget);
    expect(diagnostic.status).toBe('closed');
  });

  it('diagnoses a target with doctorado as incompatible', () => {
    const doctoradoTarget: AcademicTarget = {
      ...operationalTarget,
      offerType: 'doctorado',
      offer: {
        id: 101,
        slug: 'doc',
        name: 'Doctorado',
        type: 'doctorado',
      },
    };
    const diagnostic = diagnoseTarget(doctoradoTarget);
    expect(diagnostic.status).toBe('incompatible');
    expect(diagnostic.issues).toContain('unsupported_offer_type: doctorado');
  });

  it('diagnoses a target without offer type as incompatible', () => {
    const noTypeTarget: AcademicTarget = {
      ...operationalTarget,
      offerType: undefined,
      offer: undefined,
    };
    const diagnostic = diagnoseTarget(noTypeTarget);
    expect(diagnostic.status).toBe('incompatible');
    expect(diagnostic.issues).toContain('Falta especificar el tipo de oferta académica');
  });

  describe('seminar availability diagnostics', () => {
    const seminarTarget: AcademicTarget = {
      id: 'sem-ed1',
      kind: 'seminar',
      title: 'Seminario Test',
      registrationOpen: true,
      configRevision: 'rev-1',
      orientations: [],
      mentions: [],
      urls: {
        legacyRegistration: 'https://flacso.edu.uy/seminario/test/',
      },
    };

    it('diagnoses open seminar edition as operational', () => {
      const resolutions = new Map([
        ['/seminario/test/', { status: 'open' as const, targetId: 'sem-ed1' }],
      ]);
      const diag = diagnoseTarget(seminarTarget, undefined, resolutions);
      expect(diag.status).toBe('operational');
      expect(diag.registrationAvailability).toBe('open');
      expect(diag.registrationOpen).toBe(true);
      expect(diag.issues).toHaveLength(0);
    });

    it('diagnoses closed sibling seminar edition under open permalink as closed', () => {
      const resolutions = new Map([
        ['/seminario/test/', { status: 'open' as const, targetId: 'sem-ed2' }],
      ]);
      const diag = diagnoseTarget(seminarTarget, undefined, resolutions);
      expect(diag.status).toBe('closed');
      expect(diag.registrationAvailability).toBe('closed');
      expect(diag.registrationOpen).toBe(false);
    });

    it('diagnoses multiple open seminar editions conflict as incompatible', () => {
      const resolutions = new Map([
        ['/seminario/test/', { status: 'conflict' as const, issue: 'multiple_open_seminar_editions' as const }],
      ]);
      const diag = diagnoseTarget(seminarTarget, undefined, resolutions);
      expect(diag.status).toBe('incompatible');
      expect(diag.registrationAvailability).toBe('conflict');
      expect(diag.registrationOpen).toBe(false);
      expect(diag.issues).toContain('multiple_open_seminar_editions');
    });

    it('diagnoses inconsistent permalink conflict as incompatible', () => {
      const resolutions = new Map([
        ['/seminario/test/', { status: 'conflict' as const, issue: 'inconsistent_seminar_permalink' as const }],
      ]);
      const diag = diagnoseTarget(seminarTarget, undefined, resolutions);
      expect(diag.status).toBe('incompatible');
      expect(diag.registrationAvailability).toBe('conflict');
      expect(diag.registrationOpen).toBe(false);
      expect(diag.issues).toContain('inconsistent_seminar_permalink');
    });
  });
});
