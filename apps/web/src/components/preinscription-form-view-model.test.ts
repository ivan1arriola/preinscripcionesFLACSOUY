import { describe, expect, it } from 'vitest';
import type { FormDefinition, SubmissionFileToken } from '@flacso/contracts';
import {
  getDocumentProgress,
  getFirstErrorSectionIndex,
  getMobileFormSections,
} from './preinscription-form-view-model.js';

const form = (overrides: Partial<FormDefinition> = {}): FormDefinition => ({
  targetId: 'target-1',
  kind: 'academic_offer',
  title: 'Oferta',
  offerType: 'diploma',
  profileVersionId: 'profile-1',
  steps: [],
  registrationOpen: true,
  inputs: [
    { key: 'nombre1', label: 'Nombre', type: 'text', required: true, position: 1, stepId: 'personal' },
    { key: 'estudios', label: 'Estudios', type: 'textarea', required: true, position: 2, stepId: 'academico' },
    { key: 'orientacion', label: 'Orientación', type: 'select', required: true, position: 3, stepId: 'orientacion' },
    { key: 'mencion', label: 'Mención', type: 'select', required: false, position: 4, stepId: 'orientacion' },
    { key: 'email', label: 'Correo', type: 'email', required: true, position: 5, stepId: 'contacto' },
  ],
  documents: [
    { key: 'cv', label: 'CV', required: true, canDefer: false, maxFiles: 1, maxBytes: 100, acceptedMimeTypes: ['application/pdf'], position: 1, stepId: 'documentos' },
    { key: 'identidad', label: 'Identidad', required: true, canDefer: false, maxFiles: 1, maxBytes: 100, acceptedMimeTypes: ['application/pdf'], position: 2, stepId: 'documentos' },
  ],
  orientations: ['Social'],
  mentions: ['Políticas'],
  agreements: [],
  configRevision: 'rev-1',
  effectiveRevision: 'rev-1',
  ...overrides,
});

describe('mobile preinscription form view model', () => {
  it('separates academic history from preinscription options', () => {
    const sections = getMobileFormSections(form());
    expect(sections.map((section) => section.category)).toEqual([
      'personal-data',
      'contact',
      'academic-history',
      'preinscription-options',
      'documents',
      'declarations',
    ]);
    expect(sections.find((section) => section.category === 'academic-history')?.inputKeys).toContain('estudios');
    expect(sections.find((section) => section.category === 'academic-history')?.inputKeys).not.toContain('orientacion');
    expect(sections.find((section) => section.category === 'preinscription-options')?.inputKeys).toEqual(['orientacion', 'mencion']);
  });

  it('omits preinscription options when the target has no options', () => {
    const sections = getMobileFormSections(form({ orientations: [], mentions: [] }));
    expect(sections.some((section) => section.category === 'preinscription-options')).toBe(false);
  });

  it('counts required uploaded documents', () => {
    const files = [{ token: 'cv-token', fieldKey: 'cv', originalName: 'cv.pdf', size: 10, mimeType: 'application/pdf' }] as SubmissionFileToken[];
    expect(getDocumentProgress(form().documents, files)).toEqual({ uploaded: 1, required: 2, complete: false });
  });

  it('maps the first field error to its section', () => {
    const sections = getMobileFormSections(form());
    expect(getFirstErrorSectionIndex(sections, { orientacion: 'Obligatoria' })).toBe(3);
    expect(getFirstErrorSectionIndex(sections, { desconocido: 'Error' })).toBe(-1);
  });
});
