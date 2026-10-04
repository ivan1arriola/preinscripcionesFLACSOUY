import { describe, it, expect } from 'vitest';
import type { AcademicTarget, FormDefinition, SubmissionFileToken } from '@flacso/contracts';
import { getCanonicalFormDefinition } from './canonical-forms.js';
import { validateSubmission } from './form-validation.js';

describe('Document Rules Domain Specification', () => {
  const seminarTarget: AcademicTarget = {
    id: 'seminar-politicas',
    kind: 'seminar',
    title: 'Seminario en Políticas Públicas',
    registrationOpen: true,
    configRevision: 'rev-sem',
    orientations: [],
    mentions: [],
  };

  const diplomaTarget: AcademicTarget = {
    id: 'diploma-davia',
    kind: 'academic_offer',
    offerType: 'diploma',
    title: 'Diploma DAVIA',
    registrationOpen: true,
    configRevision: 'rev-dip',
    orientations: [],
    mentions: [],
  };

  const maestriaTarget: AcademicTarget = {
    id: 'maestria-genero',
    kind: 'academic_offer',
    offerType: 'maestria',
    title: 'Maestría en Género',
    registrationOpen: true,
    configRevision: 'rev-mae',
    orientations: [],
    mentions: [],
  };

  it('canonicalDocumentsForSeminarExcludeLetters: seminar excludes motivation and recommendations', () => {
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

    const inputKeys = form.inputs.map((i) => i.key);
    expect(inputKeys).not.toContain('escolaridad');
    expect(inputKeys).toContain('tituloDenominacion');
  });

  it('composes non-master offer documents with motivation and without recommendations', () => {
    const result = getCanonicalFormDefinition(diplomaTarget);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const form = result.value;
    const docKeys = form.documents.map((d) => d.key);
    expect(docKeys).toEqual(['identidad', 'cv', 'titulo', 'cartaMotivacion']);
    expect(docKeys).not.toContain('cartaRecomendacion1');
    expect(docKeys).not.toContain('cartaRecomendacion2');
    expect(form.recommendationLettersCount).toBe(0);

    const tituloDoc = form.documents.find((d) => d.key === 'titulo');
    expect(tituloDoc?.companionInputKey).toBe('tituloDenominacion');
    expect(tituloDoc?.alternative).toEqual({
      kind: 'absence',
      valueKey: 'sinTituloActual',
      activeValue: 'Si',
      label: 'No poseo actualmente título',
    });

    const inputKeys = form.inputs.map((i) => i.key);
    expect(inputKeys).not.toContain('escolaridad');
    expect(inputKeys).toContain('tituloDenominacion');
  });

  it('composes maestria documents with deferrable recommendation letters', () => {
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
    expect(form.recommendationLettersCount).toBe(2);

    const rec1 = form.documents.find((d) => d.key === 'cartaRecomendacion1');
    expect(rec1?.canDefer).toBe(true);
    expect(rec1?.alternative).toEqual({
      kind: 'defer',
      valueKey: 'cartaRecomendacion1Pendiente',
      activeValue: 'Si',
      label: 'Adjuntar posteriormente',
    });

    const rec2 = form.documents.find((d) => d.key === 'cartaRecomendacion2');
    expect(rec2?.canDefer).toBe(true);
    expect(rec2?.alternative).toEqual({
      kind: 'defer',
      valueKey: 'cartaRecomendacion2Pendiente',
      activeValue: 'Si',
      label: 'Adjuntar posteriormente',
    });
  });

  describe('titleAbsenceToggleClearsCompanionAndRejectsFiles', () => {
    const getDiplomaForm = (): FormDefinition => {
      const res = getCanonicalFormDefinition(diplomaTarget);
      if (!res.ok) throw new Error(res.error.message);
      return res.value;
    };

    const validBaseValues: Record<string, string> = {
      nombre1: 'María',
      apellido1: 'Rodríguez',
      fechaNacimiento: '1990-05-15',
      tipoDocumento: 'cedula_uruguaya',
      documento: '34567894',
      paisEmisorDocumento: 'Uruguay',
      genero: 'Mujer',
      etnia: 'Mestiza',
      paisNacimiento: 'Uruguay',
      paisResidencia: 'Uruguay',
      ciudadResidencia: 'Montevideo',
      celular: '+598 99 123 456',
      email: 'maria@example.com',
      ocupacion: 'Docente',
      estudios: 'Universitarios completos',
      posgradoFlacso: 'No',
      tieneConvenio: 'No',
      fuente: 'Redes sociales',
      aceptaDifusion: 'Si',
    };

    const baseFiles: SubmissionFileToken[] = [
      { token: 'tok-id', fieldKey: 'identidad', originalName: 'id.pdf', size: 1024, mimeType: 'application/pdf' },
      { token: 'tok-cv', fieldKey: 'cv', originalName: 'cv.pdf', size: 1024, mimeType: 'application/pdf' },
      { token: 'tok-mot', fieldKey: 'cartaMotivacion', originalName: 'mot.pdf', size: 1024, mimeType: 'application/pdf' },
    ];

    it('accepts title absence when sinTituloActual=Si, denomination is empty, and no file is attached', () => {
      const form = getDiplomaForm();
      const values = {
        ...validBaseValues,
        sinTituloActual: 'Si',
        tituloDenominacion: '',
      };
      const files = [...baseFiles];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(true);
      expect(validation.fieldErrors).toEqual({});
    });

    it('rejects title absence when sinTituloActual=Si but a title file is attached', () => {
      const form = getDiplomaForm();
      const values = {
        ...validBaseValues,
        sinTituloActual: 'Si',
        tituloDenominacion: '',
      };
      const files = [
        ...baseFiles,
        { token: 'tok-tit', fieldKey: 'titulo', originalName: 'titulo.pdf', size: 1024, mimeType: 'application/pdf' },
      ];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(false);
      expect(validation.fieldErrors.titulo).toBeDefined();
    });

    it('rejects title absence when sinTituloActual=Si but tituloDenominacion is provided', () => {
      const form = getDiplomaForm();
      const values = {
        ...validBaseValues,
        sinTituloActual: 'Si',
        tituloDenominacion: 'Licenciada en Sociología',
      };
      const files = [...baseFiles];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(false);
      expect(validation.fieldErrors.tituloDenominacion).toBeDefined();
    });

    it('accepts regular title when sinTituloActual=No, denomination is provided, and file is attached', () => {
      const form = getDiplomaForm();
      const values = {
        ...validBaseValues,
        sinTituloActual: 'No',
        tituloDenominacion: 'Licenciada en Sociología',
      };
      const files = [
        ...baseFiles,
        { token: 'tok-tit', fieldKey: 'titulo', originalName: 'titulo.pdf', size: 1024, mimeType: 'application/pdf' },
      ];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(true);
      expect(validation.fieldErrors).toEqual({});
    });

    it('rejects regular title when sinTituloActual=No and denomination is missing', () => {
      const form = getDiplomaForm();
      const values = {
        ...validBaseValues,
        sinTituloActual: 'No',
        tituloDenominacion: '',
      };
      const files = [
        ...baseFiles,
        { token: 'tok-tit', fieldKey: 'titulo', originalName: 'titulo.pdf', size: 1024, mimeType: 'application/pdf' },
      ];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(false);
      expect(validation.fieldErrors.tituloDenominacion).toBeDefined();
    });

    it('rejects regular title when sinTituloActual=No and title file is missing', () => {
      const form = getDiplomaForm();
      const values = {
        ...validBaseValues,
        sinTituloActual: 'No',
        tituloDenominacion: 'Licenciada en Sociología',
      };
      const files = [...baseFiles];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(false);
      expect(validation.fieldErrors.titulo).toBeDefined();
    });
  });

  describe('validateRecommendationCompletionChoices', () => {
    const getMaestriaForm = (): FormDefinition => {
      const res = getCanonicalFormDefinition(maestriaTarget);
      if (!res.ok) throw new Error(res.error.message);
      return res.value;
    };

    const validBaseValues: Record<string, string> = {
      nombre1: 'Carlos',
      apellido1: 'García',
      fechaNacimiento: '1985-11-20',
      tipoDocumento: 'cedula_uruguaya',
      documento: '3.456.789-4',
      paisEmisorDocumento: 'Uruguay',
      genero: 'Varon',
      etnia: 'Blanca',
      paisNacimiento: 'Uruguay',
      paisResidencia: 'Uruguay',
      ciudadResidencia: 'Montevideo',
      celular: '+598 98 765 432',
      email: 'carlos@example.com',
      ocupacion: 'Investigador',
      estudios: 'Licenciatura completa',
      posgradoFlacso: 'No',
      sinTituloActual: 'No',
      tituloDenominacion: 'Licenciado en Ciencia Política',
      tieneConvenio: 'No',
      fuente: 'Correo electrónico',
      aceptaDifusion: 'Si',
    };

    const baseFiles: SubmissionFileToken[] = [
      { token: 'tok-id', fieldKey: 'identidad', originalName: 'id.pdf', size: 1024, mimeType: 'application/pdf' },
      { token: 'tok-cv', fieldKey: 'cv', originalName: 'cv.pdf', size: 1024, mimeType: 'application/pdf' },
      { token: 'tok-tit', fieldKey: 'titulo', originalName: 'tit.pdf', size: 1024, mimeType: 'application/pdf' },
      { token: 'tok-mot', fieldKey: 'cartaMotivacion', originalName: 'mot.pdf', size: 1024, mimeType: 'application/pdf' },
    ];

    it('accepts both recommendation letters attached now', () => {
      const form = getMaestriaForm();
      const values = {
        ...validBaseValues,
        cartaRecomendacion1Pendiente: 'No',
        cartaRecomendacion2Pendiente: 'No',
      };
      const files = [
        ...baseFiles,
        { token: 'tok-rec1', fieldKey: 'cartaRecomendacion1', originalName: 'rec1.pdf', size: 1024, mimeType: 'application/pdf' },
        { token: 'tok-rec2', fieldKey: 'cartaRecomendacion2', originalName: 'rec2.pdf', size: 1024, mimeType: 'application/pdf' },
      ];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(true);
      expect(validation.fieldErrors).toEqual({});
    });

    it('accepts both recommendation letters deferred', () => {
      const form = getMaestriaForm();
      const values = {
        ...validBaseValues,
        cartaRecomendacion1Pendiente: 'Si',
        cartaRecomendacion2Pendiente: 'Si',
      };
      const files = [...baseFiles];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(true);
      expect(validation.fieldErrors).toEqual({});
    });

    it('rejects when letter is marked pending but file is also attached', () => {
      const form = getMaestriaForm();
      const values = {
        ...validBaseValues,
        cartaRecomendacion1Pendiente: 'Si',
        cartaRecomendacion2Pendiente: 'No',
      };
      const files = [
        ...baseFiles,
        { token: 'tok-rec1', fieldKey: 'cartaRecomendacion1', originalName: 'rec1.pdf', size: 1024, mimeType: 'application/pdf' },
        { token: 'tok-rec2', fieldKey: 'cartaRecomendacion2', originalName: 'rec2.pdf', size: 1024, mimeType: 'application/pdf' },
      ];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(false);
      expect(validation.fieldErrors.cartaRecomendacion1).toBeDefined();
    });

    it('rejects when letter is not marked pending and file is missing', () => {
      const form = getMaestriaForm();
      const values = {
        ...validBaseValues,
        cartaRecomendacion1Pendiente: 'No',
        cartaRecomendacion2Pendiente: 'No',
      };
      const files = [
        ...baseFiles,
        // missing cartaRecomendacion1 and cartaRecomendacion2
      ];

      const validation = validateSubmission(form, values, form.effectiveRevision, files);
      expect(validation.valid).toBe(false);
      expect(validation.fieldErrors.cartaRecomendacion1).toBeDefined();
      expect(validation.fieldErrors.cartaRecomendacion2).toBeDefined();
    });
  });
});
