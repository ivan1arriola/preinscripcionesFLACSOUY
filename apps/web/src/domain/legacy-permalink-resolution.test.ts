import { describe, it, expect } from 'vitest';
import type { DiagnosticTarget } from '@flacso/contracts';
import {
  resolveLegacyPermalink,
  normalizePath,
  legacyPathForTarget,
} from './legacy-permalink-resolution.js';

describe('resolveLegacyPermalink', () => {
  const baseSeminar = (
    id: string,
    open: boolean,
    availability?: 'open' | 'closed' | 'conflict',
    permalink = 'https://flacso.edu.uy/seminario/curso-test/'
  ): DiagnosticTarget => ({
    id,
    kind: 'seminar',
    title: `Seminario Test ${id}`,
    registrationOpen: open,
    registrationAvailability: availability,
    status: availability === 'conflict' ? 'incompatible' : open ? 'operational' : 'closed',
    configRevision: 'rev-1',
    issues: availability === 'conflict' ? ['multiple_open_seminar_editions'] : [],
    urls: {
      legacyRegistration: permalink,
    },
  });

  const baseAcademicOffer = (id: string, permalink: string): DiagnosticTarget => ({
    id,
    kind: 'academic_offer',
    title: `Oferta ${id}`,
    offerType: 'maestria',
    registrationOpen: true,
    status: 'operational',
    configRevision: 'rev-1',
    issues: [],
    urls: {
      legacyRegistration: permalink,
    },
  });

  it('normalizes paths correctly with trailing slash', () => {
    expect(normalizePath('/seminario/curso')).toBe('/seminario/curso/');
    expect(normalizePath('/seminario/curso/')).toBe('/seminario/curso/');
    expect(normalizePath('/')).toBe('/');
  });

  it('resolves legacy path for target correctly', () => {
    const target = baseSeminar('sem-1', true, 'open', 'https://flacso.edu.uy/seminario/metodologia');
    expect(legacyPathForTarget(target)).toBe('/seminario/metodologia/');
  });

  it('resolves an open edition when both open and closed editions exist for the permalink', () => {
    const targets = [
      baseSeminar('sem-ed1', false, 'closed'),
      baseSeminar('sem-ed2', true, 'open'),
    ];

    const result = resolveLegacyPermalink(targets, '/seminario/curso-test/');
    expect(result.kind).toBe('target');
    if (result.kind === 'target') {
      expect(result.target.id).toBe('sem-ed2');
    }
  });

  it('returns closed when all editions under the permalink are closed', () => {
    const targets = [
      baseSeminar('sem-ed1', false, 'closed'),
      baseSeminar('sem-ed2', false, 'closed'),
    ];

    const result = resolveLegacyPermalink(targets, '/seminario/curso-test/');
    expect(result.kind).toBe('closed');
  });

  it('returns conflict when two editions are open under the same permalink', () => {
    const targets = [
      baseSeminar('sem-ed1', true, 'open'),
      baseSeminar('sem-ed2', true, 'open'),
    ];

    const result = resolveLegacyPermalink(targets, '/seminario/curso-test/');
    expect(result.kind).toBe('conflict');
  });

  it('returns not_found when path does not match any targets', () => {
    const targets = [baseSeminar('sem-ed1', true, 'open')];
    const result = resolveLegacyPermalink(targets, '/seminario/inexistente/');
    expect(result.kind).toBe('not_found');
  });

  it('resolves an academic offer path to its open cohort', () => {
    const targets = [
      baseAcademicOffer('oferta-1', 'https://flacso.edu.uy/oferta/davia/'),
    ];

    const result = resolveLegacyPermalink(targets, '/oferta/davia/');
    expect(result.kind).toBe('target');
    if (result.kind === 'target') {
      expect(result.target.id).toBe('oferta-1');
    }
  });

  it('resolves an offer path to the open cohort even when an older closed cohort comes first', () => {
    const permalink = 'https://flacso.edu.uy/oferta/diplomado-violencias/';
    const closedCohort: DiagnosticTarget = {
      ...baseAcademicOffer('cohorte-vieja', permalink),
      registrationOpen: false,
      registrationAvailability: 'closed',
      status: 'closed',
    };
    const openCohort: DiagnosticTarget = { ...baseAcademicOffer('cohorte-nueva', permalink), registrationAvailability: 'open' };

    const result = resolveLegacyPermalink([closedCohort, openCohort], '/oferta/diplomado-violencias/');
    expect(result.kind).toBe('target');
    if (result.kind === 'target') {
      expect(result.target.id).toBe('cohorte-nueva');
    }
  });

  it('returns closed for an offer path whose cohorts are all closed', () => {
    const closedCohort: DiagnosticTarget = {
      ...baseAcademicOffer('cohorte-vieja', 'https://flacso.edu.uy/oferta/davia/'),
      registrationOpen: false,
      registrationAvailability: 'closed',
      status: 'closed',
    };

    expect(resolveLegacyPermalink([closedCohort], '/oferta/davia/').kind).toBe('closed');
  });
});
