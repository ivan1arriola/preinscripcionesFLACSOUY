import { describe, it, expect } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import {
  resolveSeminarPermalinks,
  normalizePermalink,
} from './seminar-permalink-availability.js';

describe('Seminar permalink availability resolution', () => {
  describe('normalizePermalink', () => {
    it('normalizes relative and absolute URLs to standard slash-bounded paths', () => {
      expect(normalizePermalink('https://flacso.edu.uy/seminario/curso-a/')).toBe('/seminario/curso-a/');
      expect(normalizePermalink('https://flacso.edu.uy/seminario/curso-a')).toBe('/seminario/curso-a/');
      expect(normalizePermalink('/seminario/curso-a')).toBe('/seminario/curso-a/');
      expect(normalizePermalink('seminario/curso-a/')).toBe('/seminario/curso-a/');
      expect(normalizePermalink('https://flacso.edu.uy/Seminario/Curso-A/')).toBe('/seminario/curso-a/');
    });
  });

  describe('resolveSeminarPermalinks', () => {
    const baseSeminarTarget = (id: string, editionId: number, permalink: string, open: boolean, availability?: 'open' | 'closed' | 'conflict'): AcademicTarget => ({
      id,
      kind: 'seminar',
      title: `Seminario Test Edición ${editionId}`,
      registrationOpen: open,
      registrationAvailability: availability,
      configRevision: 'rev-1',
      wordpress: {
        seminarId: 50,
        editionId,
      },
      seminar: {
        id: 50,
        slug: 'seminario-test',
        name: 'Seminario Test',
        type: 'seminar',
      },
      orientations: [],
      mentions: [],
      urls: {
        legacyRegistration: permalink,
      },
    });

    it('resolves a permalink with one open and one closed edition to the open edition', () => {
      const targets: AcademicTarget[] = [
        baseSeminarTarget('target-ed-1', 1, 'https://flacso.edu.uy/seminario/curso-test/', false, 'closed'),
        baseSeminarTarget('target-ed-2', 2, 'https://flacso.edu.uy/seminario/curso-test/', true, 'open'),
      ];

      const resolutions = resolveSeminarPermalinks(targets);
      const res = resolutions.get('/seminario/curso-test/');

      expect(res).toBeDefined();
      expect(res?.status).toBe('open');
      expect(res?.targetId).toBe('target-ed-2');
      expect(res?.issue).toBeUndefined();
    });

    it('resolves a permalink with no open editions as closed', () => {
      const targets: AcademicTarget[] = [
        baseSeminarTarget('target-ed-1', 1, 'https://flacso.edu.uy/seminario/curso-test/', false, 'closed'),
        baseSeminarTarget('target-ed-2', 2, 'https://flacso.edu.uy/seminario/curso-test/', false, 'closed'),
      ];

      const resolutions = resolveSeminarPermalinks(targets);
      const res = resolutions.get('/seminario/curso-test/');

      expect(res).toBeDefined();
      expect(res?.status).toBe('closed');
      expect(res?.targetId).toBeUndefined();
      expect(res?.issue).toBeUndefined();
    });

    it('resolves a permalink with two open editions as conflict and selects no target', () => {
      const targets: AcademicTarget[] = [
        baseSeminarTarget('target-ed-1', 1, 'https://flacso.edu.uy/seminario/curso-test/', true, 'open'),
        baseSeminarTarget('target-ed-2', 2, 'https://flacso.edu.uy/seminario/curso-test/', true, 'open'),
      ];

      const resolutions = resolveSeminarPermalinks(targets);
      const res = resolutions.get('/seminario/curso-test/');

      expect(res).toBeDefined();
      expect(res?.status).toBe('conflict');
      expect(res?.issue).toBe('multiple_open_seminar_editions');
      expect(res?.targetId).toBeUndefined();
    });

    it('handles targets without legacyRegistration gracefully', () => {
      const targets: AcademicTarget[] = [
        {
          ...baseSeminarTarget('target-no-url', 1, '', false, 'closed'),
          urls: undefined,
        },
      ];

      const resolutions = resolveSeminarPermalinks(targets);
      expect(resolutions.size).toBe(0);
    });

    it('ignores academic offers sharing the same path and only evaluates seminar targets', () => {
      const targets: AcademicTarget[] = [
        {
          id: 'offer-target-1',
          kind: 'academic_offer',
          title: 'Maestría',
          offerType: 'maestria',
          registrationOpen: true,
          configRevision: 'rev-1',
          orientations: [],
          mentions: [],
          urls: {
            legacyRegistration: 'https://flacso.edu.uy/seminario/curso-test/',
          },
        },
        baseSeminarTarget('target-ed-1', 1, 'https://flacso.edu.uy/seminario/curso-test/', true, 'open'),
      ];

      const resolutions = resolveSeminarPermalinks(targets);
      const res = resolutions.get('/seminario/curso-test/');

      expect(res).toBeDefined();
      expect(res?.status).toBe('open');
      expect(res?.targetId).toBe('target-ed-1');
    });

    it('marks conflict with inconsistent_seminar_permalink when editions of the same seminar have different permalinks', () => {
      const targets: AcademicTarget[] = [
        baseSeminarTarget('target-ed-1', 1, 'https://flacso.edu.uy/seminario/curso-viejo/', false, 'closed'),
        baseSeminarTarget('target-ed-2', 2, 'https://flacso.edu.uy/seminario/curso-nuevo/', true, 'open'),
      ];

      const resolutions = resolveSeminarPermalinks(targets);

      const resViejo = resolutions.get('/seminario/curso-viejo/');
      const resNuevo = resolutions.get('/seminario/curso-nuevo/');

      expect(resViejo?.status).toBe('conflict');
      expect(resViejo?.issue).toBe('inconsistent_seminar_permalink');
      expect(resViejo?.targetId).toBeUndefined();

      expect(resNuevo?.status).toBe('conflict');
      expect(resNuevo?.issue).toBe('inconsistent_seminar_permalink');
      expect(resNuevo?.targetId).toBeUndefined();
    });

    it('supports backward compatibility using registrationOpen when registrationAvailability is not provided', () => {
      const targets: AcademicTarget[] = [
        baseSeminarTarget('target-ed-1', 1, 'https://flacso.edu.uy/seminario/curso-test/', false),
        baseSeminarTarget('target-ed-2', 2, 'https://flacso.edu.uy/seminario/curso-test/', true),
      ];

      const resolutions = resolveSeminarPermalinks(targets);
      const res = resolutions.get('/seminario/curso-test/');

      expect(res?.status).toBe('open');
      expect(res?.targetId).toBe('target-ed-2');
    });
  });
});
