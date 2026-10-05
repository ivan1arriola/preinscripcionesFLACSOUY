import { describe, expect, it } from 'vitest';
import type { FormDefinition } from '@flacso/contracts';
import {
  buildSpreadsheetSchema,
  buildSpreadsheetValues,
  collapseLegacySpreadsheetRow,
} from './spreadsheet-schema.js';

const form: FormDefinition = {
  targetId: 'target-1',
  kind: 'academic_offer',
  title: 'Oferta de prueba',
  offerType: 'maestria',
  profileVersionId: 'profile-1',
  effectiveRevision: 'rev-1',
  registrationOpen: true,
  configRevision: 'config-1',
  steps: [],
  inputs: [
    { key: 'nombre1', label: 'Primer nombre', type: 'text', required: true, spreadsheetColumn: 'Primer nombre' },
    { key: 'posgradoFlacso', label: '¿Cursaste algún posgrado en FLACSO?', type: 'select', required: true, spreadsheetColumn: '¿Cursó posgrado en FLACSO?' },
    { key: 'posgradoCual', label: '¿Cuál posgrado?', type: 'text', required: false, spreadsheetColumn: 'Cuál posgrado' },
    { key: 'tieneConvenio', label: '¿Te corresponde algún convenio?', type: 'select', required: true, spreadsheetColumn: '¿Te corresponde algún convenio?' },
    { key: 'convenioWordpressId', label: '¿Cuál convenio?', type: 'text', required: false, spreadsheetColumn: 'Convenio' },
    { key: 'orientacion', label: 'Orientación', type: 'select', required: true, spreadsheetColumn: 'Orientación' },
  ],
  documents: [],
  orientations: ['Educación'],
  mentions: [],
  agreements: [{ id: '27120', label: 'Convenio FLACSO - Udelar' }],
  recommendationLettersCount: 0,
};

describe('spreadsheet schema', () => {
  it('includes only asked form fields plus tracking metadata and collapses conditional pairs', () => {
    expect(buildSpreadsheetSchema(form).headers).toEqual([
      'ID de seguimiento',
      'Fecha de preinscripción',
      'Primer nombre',
      'Posgrado en FLACSO',
      'Convenio',
      'Orientación',
    ]);
  });

  it('writes readable values for positive and negative conditional answers', () => {
    const values = buildSpreadsheetValues(form, {
      nombre1: 'Iván',
      posgradoFlacso: 'Si',
      posgradoCual: 'Maestría en Educación',
      tieneConvenio: 'Si',
      convenioWordpressId: '27120',
      orientacion: 'Educación',
    }, 'sub_123', new Date('2026-10-05T12:00:00.000Z'));

    expect(values).toMatchObject({
      'ID de seguimiento': 'sub_123',
      'Fecha de preinscripción': '2026-10-05T12:00:00.000Z',
      'Posgrado en FLACSO': 'Maestría en Educación',
      Convenio: 'Convenio FLACSO - Udelar',
    });
    expect(values['¿Cursó posgrado en FLACSO?']).toBeUndefined();
  });

  it('converts negative legacy answers to No during migration', () => {
    const migrated = collapseLegacySpreadsheetRow(
      ['¿Cursó posgrado en FLACSO?', 'Cuál posgrado', '¿Te corresponde algún convenio?', 'Convenio'],
      ['No', '', 'No', ''],
      ['ID de seguimiento', 'Posgrado en FLACSO', 'Convenio'],
    );

    expect(migrated).toEqual(['', 'No', 'No']);
  });
});
