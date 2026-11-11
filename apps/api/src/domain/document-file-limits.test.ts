import { describe, expect, it } from 'vitest';
import { getCanonicalFormDefinition, type AcademicTarget } from '@flacso/contracts';

const target = (offerType: string): AcademicTarget =>
  ({
    id: `${offerType}-1`, kind: 'academic_offer', offerType, title: offerType, registrationOpen: true,
    configRevision: 'rev-1', orientations: [], mentions: [],
  }) as AcademicTarget;

describe('Límites de archivos de los documentos canónicos', () => {
  for (const offerType of ['diploma', 'diplomado', 'especializacion', 'maestria']) {
    it(`${offerType}: todos los documentos admiten hasta 2 archivos, PDF o imagen`, () => {
      const result = getCanonicalFormDefinition(target(offerType));
      if (!result.ok) throw new Error(result.error.message);
      const documents = result.value.documents ?? [];
      expect(documents.length).toBeGreaterThan(0);
      for (const document of documents) {
        expect(document.maxFiles, `${document.key} maxFiles`).toBe(2);
        expect(document.acceptedMimeTypes, `${document.key} tipos`).toEqual(
          expect.arrayContaining(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
        );
      }
    });
  }

  it('el título admite hasta 2 archivos', () => {
    const result = getCanonicalFormDefinition(target('diploma'));
    if (!result.ok) throw new Error(result.error.message);
    expect((result.value.documents ?? []).find((d) => d.key === 'titulo')?.maxFiles).toBe(2);
  });
});
