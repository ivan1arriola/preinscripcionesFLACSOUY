import { describe, it, expect } from 'vitest';
import type { FormDefinition, DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import {
  getMobileFormSections,
  getDocumentProgress,
  getFirstErrorSectionIndex,
  type MobileFormSection,
} from './preinscription-form-view-model.js';

describe('preinscription-form-view-model', () => {
  const baseForm: FormDefinition = {
    targetId: 'flacso-oferta-1',
    title: 'Diploma en Políticas Públicas',
    kind: 'academic_offer',
    offerType: 'diploma',
    profileVersionId: 'v1',
    effectiveRevision: 'rev1',
    registrationOpen: true,
    configRevision: 'rev1',
    steps: [],
    orientations: [],
    mentions: [],
    inputs: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true, stepId: 'personal' },
      { key: 'apellido', label: 'Apellido', type: 'text', required: true, stepId: 'personal' },
      { key: 'email', label: 'Correo electrónico', type: 'email', required: true, stepId: 'contacto' },
      { key: 'paisResidencia', label: 'País de residencia', type: 'select', required: true, stepId: 'contacto' },
      { key: 'estudios', label: 'Nivel de estudios', type: 'select', required: true, stepId: 'academico' },
      { key: 'posgradoFlacso', label: '¿Realizó posgrado en FLACSO?', type: 'select', required: true, stepId: 'academico' },
      { key: 'tieneConvenio', label: '¿Posee convenio?', type: 'select', required: true, stepId: 'declaracion' },
    ],
    documents: [
      { key: 'doc_identidad', label: 'Cédula o pasaporte', required: true },
      { key: 'doc_cv', label: 'Currículum vitae', required: true },
      { key: 'doc_opcional', label: 'Certificado adicional', required: false },
    ],
  };

  describe('getMobileFormSections', () => {
    it('produces standard sections when form does not have orientacion or mencion', () => {
      const sections = getMobileFormSections(baseForm);

      expect(sections.map((s) => s.id)).toEqual([
        'personal',
        'contacto',
        'academico',
        'documentos',
        'declaracion',
      ]);

      const academicSection = sections.find((s) => s.id === 'academico')!;
      expect(academicSection.category).toBe('academic-history');
      expect(academicSection.title).toBe('Trayectoria académica');
      expect(academicSection.inputKeys).toContain('estudios');
      expect(academicSection.inputKeys).toContain('posgradoFlacso');
      expect(academicSection.inputKeys).not.toContain('orientacion');
      expect(academicSection.inputKeys).not.toContain('mencion');

      // Does not contain preinscription-options section
      expect(sections.some((s) => s.category === 'preinscription-options')).toBe(false);
    });

    it('inserts preinscription-options section immediately after academic-history when orientacion or mencion exists', () => {
      const formWithOptions: FormDefinition = {
        ...baseForm,
        inputs: [
          ...baseForm.inputs,
          { key: 'orientacion', label: 'Orientación', type: 'select', required: true, stepId: 'academico' },
          { key: 'mencion', label: 'Mención', type: 'select', required: false, stepId: 'academico' },
        ],
      };

      const sections = getMobileFormSections(formWithOptions);

      expect(sections.map((s) => s.id)).toEqual([
        'personal',
        'contacto',
        'academico',
        'opciones-preinscripcion',
        'documentos',
        'declaracion',
      ]);

      const optionsSection = sections.find((s) => s.id === 'opciones-preinscripcion')!;
      expect(optionsSection.category).toBe('preinscription-options');
      expect(optionsSection.title).toBe('Sobre esta preinscripción');
      expect(optionsSection.inputKeys).toEqual(['orientacion', 'mencion']);

      const academicSection = sections.find((s) => s.id === 'academico')!;
      expect(academicSection.inputKeys).not.toContain('orientacion');
      expect(academicSection.inputKeys).not.toContain('mencion');
    });

    it('handles form with only orientacion and no mencion', () => {
      const formWithOnlyOrientacion: FormDefinition = {
        ...baseForm,
        inputs: [
          ...baseForm.inputs,
          { key: 'orientacion', label: 'Orientación', type: 'select', required: true, stepId: 'academico' },
        ],
      };

      const sections = getMobileFormSections(formWithOnlyOrientacion);
      expect(sections.some((s) => s.id === 'opciones-preinscripcion')).toBe(true);
      const optionsSection = sections.find((s) => s.id === 'opciones-preinscripcion')!;
      expect(optionsSection.inputKeys).toEqual(['orientacion']);
    });
  });

  describe('getDocumentProgress', () => {
    const docs: DocumentDefinition[] = [
      { key: 'doc_id', label: 'Identidad', required: true },
      { key: 'doc_cv', label: 'CV', required: true },
      { key: 'doc_titulo', label: 'Título', required: true },
      { key: 'doc_opcional', label: 'Extra', required: false },
    ];

    it('returns zero progress when no files uploaded', () => {
      const progress = getDocumentProgress(docs, []);
      expect(progress).toEqual({
        uploaded: 0,
        required: 3,
        complete: false,
      });
    });

    it('tracks partial progress for required documents', () => {
      const files: SubmissionFileToken[] = [
        { token: 't1', fieldKey: 'doc_id', originalName: 'ci.pdf', mimeType: 'application/pdf', size: 100 },
        { token: 't2', fieldKey: 'doc_opcional', originalName: 'extra.pdf', mimeType: 'application/pdf', size: 200 },
      ];

      const progress = getDocumentProgress(docs, files);
      expect(progress).toEqual({
        uploaded: 1,
        required: 3,
        complete: false,
      });
    });

    it('marks complete when all required documents have at least one uploaded file', () => {
      const files: SubmissionFileToken[] = [
        { token: 't1', fieldKey: 'doc_id', originalName: 'ci.pdf', mimeType: 'application/pdf', size: 100 },
        { token: 't2', fieldKey: 'doc_cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 200 },
        { token: 't3', fieldKey: 'doc_titulo', originalName: 'titulo.pdf', mimeType: 'application/pdf', size: 300 },
      ];

      const progress = getDocumentProgress(docs, files);
      expect(progress).toEqual({
        uploaded: 3,
        required: 3,
        complete: true,
      });
    });

    it('handles empty document list', () => {
      const progress = getDocumentProgress([], []);
      expect(progress).toEqual({
        uploaded: 0,
        required: 0,
        complete: true,
      });
    });
  });

  describe('getFirstErrorSectionIndex', () => {
    const mockSections: MobileFormSection[] = [
      {
        id: 'personal',
        title: 'Datos personales',
        category: 'personal-data',
        inputKeys: ['nombre', 'apellido', 'documento'],
        documentKeys: [],
      },
      {
        id: 'contacto',
        title: 'Residencia y contacto',
        category: 'contact',
        inputKeys: ['email', 'paisResidencia'],
        documentKeys: [],
      },
      {
        id: 'academico',
        title: 'Trayectoria académica',
        category: 'academic-history',
        inputKeys: ['estudios'],
        documentKeys: [],
      },
      {
        id: 'documentos',
        title: 'Documentación requerida',
        category: 'documents',
        inputKeys: [],
        documentKeys: ['doc_id', 'doc_cv'],
      },
    ];

    it('returns -1 when no errors exist', () => {
      expect(getFirstErrorSectionIndex(mockSections, {})).toBe(-1);
    });

    it('returns the index of the first section with an error in inputKeys', () => {
      const errors = {
        email: 'Email inválido',
        estudios: 'Requerido',
      };
      // Contacto is index 1
      expect(getFirstErrorSectionIndex(mockSections, errors)).toBe(1);
    });

    it('returns the index of a document section when error matches documentKeys', () => {
      const errors = {
        doc_cv: 'Debe adjuntar currículum vitae',
      };
      // Documentos is index 3
      expect(getFirstErrorSectionIndex(mockSections, errors)).toBe(3);
    });

    it('prioritizes earlier sections over later sections', () => {
      const errors = {
        doc_cv: 'Debe adjuntar currículum vitae',
        apellido: 'Apellido es requerido',
      };
      // Personal is index 0
      expect(getFirstErrorSectionIndex(mockSections, errors)).toBe(0);
    });
  });
});
