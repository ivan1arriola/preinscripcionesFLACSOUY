import { describe, it, expect } from 'vitest';
import {
  buildDriveFolderNames,
  buildSemanticDriveFileName,
  sanitizeDriveSegment,
} from './google-drive-naming.js';

describe('Google Drive Naming and Path Utilities', () => {
  describe('sanitizeDriveSegment', () => {
    it('removes accents, normalizes spaces and replaces non-alphanumeric characters', () => {
      expect(sanitizeDriveSegment('  María José  ')).toBe('maria-jose');
      expect(sanitizeDriveSegment('Pérez-Gómez')).toBe('perez-gomez');
      expect(sanitizeDriveSegment('uno/dos\\tres')).toBe('uno-dos-tres');
      expect(sanitizeDriveSegment('a!@#b')).toBe('a-b');
      expect(sanitizeDriveSegment('---multi---dash---')).toBe('multi-dash');
    });
  });

  describe('buildDriveFolderNames', () => {
    it('builds path for academic offer with cohort name', () => {
      const target = {
        targetId: 'target-1',
        kind: 'academic_offer' as const,
        offerName: 'Maestría en Educación',
        cohortName: 'Cohorte VII',
      };
      expect(buildDriveFolderNames(target)).toEqual([
        'Ofertas académicas',
        'Maestría en Educación',
        'Cohorte VII',
      ]);
    });

    it('builds path for academic offer with cohort number fallback', () => {
      const target = {
        targetId: 'target-1',
        kind: 'academic_offer' as const,
        offerName: 'Maestría en Educación',
        cohortNumber: 8,
      };
      expect(buildDriveFolderNames(target)).toEqual([
        'Ofertas académicas',
        'Maestría en Educación',
        'Cohorte 8',
      ]);
    });

    it('builds path for seminar with edition number fallback', () => {
      const target = {
        targetId: 'target-2',
        kind: 'seminar' as const,
        seminarName: 'Seminario de Investigación',
        editionNumber: 2,
      };
      expect(buildDriveFolderNames(target)).toEqual([
        'Seminarios',
        'Seminario de Investigación',
        'Edición 2',
      ]);
    });

    it('throws error if missing required target labels', () => {
      const target = {
        targetId: 'target-3',
        kind: 'academic_offer' as const,
        offerName: 'Maestría',
        // missing cohort
      };
      expect(() => buildDriveFolderNames(target)).toThrow();
    });
  });

  describe('buildSemanticDriveFileName', () => {
    it('builds name with four names and retains original extension', () => {
      const result = buildSemanticDriveFileName({
        submissionId: 'sub-1',
        fieldKey: 'cv',
        originalName: 'mi_curriculum.pdf',
        mimeType: 'application/pdf',
        values: {
          apellido1: 'Pérez',
          apellido2: 'Gómez',
          nombre1: 'Ana',
          nombre2: 'María',
        },
        ordinal: 0,
      });
      expect(result).toBe('apellidos-perez-gomez__nombres-ana-maria__cv__sub-1.pdf');
    });

    it('omits second name and second surname when empty', () => {
      const result = buildSemanticDriveFileName({
        submissionId: 'sub-2',
        fieldKey: 'titulo',
        originalName: 'scan.pdf',
        mimeType: 'application/pdf',
        values: {
          apellido1: 'Pérez',
          apellido2: '',
          nombre1: 'Ana',
          nombre2: '',
        },
        ordinal: 0,
      });
      expect(result).toBe('apellidos-perez__nombres-ana__titulo__sub-2.pdf');
    });

    it('falls back to "postulante" if no names are provided', () => {
      const result = buildSemanticDriveFileName({
        submissionId: 'sub-3',
        fieldKey: 'cedula',
        originalName: 'id.jpg',
        mimeType: 'image/jpeg',
        values: {},
        ordinal: 0,
      });
      expect(result).toBe('postulante__cedula__sub-3.jpg');
    });

    it('infers extension from mimeType if original name has no extension', () => {
      const result = buildSemanticDriveFileName({
        submissionId: 'sub-4',
        fieldKey: 'foto',
        originalName: 'imagen', // No extension
        mimeType: 'image/png',
        values: {
          apellido1: 'López',
          nombre1: 'Juan',
        },
        ordinal: 0,
      });
      expect(result).toBe('apellidos-lopez__nombres-juan__foto__sub-4.png');
    });

    it('uses ordinal for duplicate fieldKeys', () => {
      const result1 = buildSemanticDriveFileName({
        submissionId: 'sub-5',
        fieldKey: 'carta_recomendacion',
        originalName: 'carta1.pdf',
        mimeType: 'application/pdf',
        values: {
          apellido1: 'Ríos',
          nombre1: 'Sol',
        },
        ordinal: 0,
      });
      const result2 = buildSemanticDriveFileName({
        submissionId: 'sub-5',
        fieldKey: 'carta_recomendacion',
        originalName: 'carta2.pdf',
        mimeType: 'application/pdf',
        values: {
          apellido1: 'Ríos',
          nombre1: 'Sol',
        },
        ordinal: 1,
      });
      expect(result1).toBe('apellidos-rios__nombres-sol__carta-recomendacion__sub-5.pdf');
      expect(result2).toBe('apellidos-rios__nombres-sol__carta-recomendacion-2__sub-5.pdf');
    });
  });
});
