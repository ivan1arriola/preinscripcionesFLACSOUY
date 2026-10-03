import { describe, expect, it } from 'vitest';
import {
  buildDriveFolderNames,
  buildSemanticDriveFileName,
  sanitizeDriveSegment,
  type DriveTargetDescriptor,
} from './google-drive-naming.js';

describe('Google Drive hierarchy and semantic names', () => {
  it('builds the academic offer hierarchy', () => {
    const target: DriveTargetDescriptor = {
      targetId: 'offer-1',
      kind: 'academic_offer',
      offerName: 'Maestría en Educación',
      cohortName: 'Cohorte VII',
    };

    expect(buildDriveFolderNames(target)).toEqual([
      'Ofertas académicas',
      'Maestría en Educación',
      'Cohorte VII',
    ]);
  });

  it('uses the seminar branch and edition fallback', () => {
    expect(buildDriveFolderNames({
      targetId: 'seminar-1',
      kind: 'seminar',
      seminarName: 'Diseño de cursos virtuales',
      editionNumber: 3,
    })).toEqual(['Seminarios', 'Diseño de cursos virtuales', 'Edición 3']);
  });

  it('omits optional identity parts and preserves semantic labels', () => {
    expect(buildSemanticDriveFileName({
      submissionId: 'sub-1',
      fieldKey: 'cv',
      originalName: 'Currículum.pdf',
      mimeType: 'application/pdf',
      values: { apellido1: 'Pérez', apellido2: 'Gómez', nombre1: 'Ana', nombre2: 'María' },
      ordinal: 1,
    })).toBe('apellidos-perez-gomez__nombres-ana-maria__cv__sub-1.pdf');

    expect(buildSemanticDriveFileName({
      submissionId: 'sub-1',
      fieldKey: 'cv',
      originalName: 'cv',
      mimeType: 'application/pdf',
      values: { apellido1: 'Pérez', apellido2: '', nombre1: 'Ana', nombre2: '' },
      ordinal: 1,
    })).toBe('apellidos-perez__nombres-ana__cv__sub-1.pdf');
  });

  it('sanitizes segments deterministically', () => {
    expect(sanitizeDriveSegment('  Educación / Género  ')).toBe('educacion-genero');
  });
});
