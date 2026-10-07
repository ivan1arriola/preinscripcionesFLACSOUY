import { describe, expect, it } from 'vitest';
import type { FormDefinition } from '@flacso/contracts';
import {
  buildSpreadsheetSchema,
  buildSpreadsheetValues,
  collapseLegacySpreadsheetRow,
  extractPhoneCountryCode,
  SPREADSHEET_TRACKING_COLUMN,
  SPREADSHEET_DATE_COLUMN,
  SPREADSHEET_DOCUMENTS_FOLDER_COLUMN,
  SPREADSHEET_PHONE_COUNTRY_COLUMN,
} from './spreadsheet-schema.js';

const comprehensiveForm: FormDefinition = {
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
    { key: 'tipoDocumento', label: 'Tipo de documento', type: 'select', required: true, spreadsheetColumn: 'Tipo de documento' },
    { key: 'paisEmisorDocumento', label: 'País emisor del documento', type: 'text', required: true, spreadsheetColumn: 'País emisor del documento' },
    { key: 'documento', label: 'Número de documento', type: 'text', required: true, spreadsheetColumn: 'Número de documento' },
    { key: 'genero', label: 'Identidad de género', type: 'select', required: true, spreadsheetColumn: 'Identidad de género' },
    { key: 'generoOtra', label: 'Especifique su identidad de género', type: 'text', required: false, spreadsheetColumn: 'Especificación de identidad de género' },
    { key: 'celular', label: 'Celular', type: 'tel', required: true, spreadsheetColumn: 'Celular' },
    { key: 'estudios', label: 'Estudios cursados', type: 'textarea', required: true, spreadsheetColumn: 'Estudios cursados' },
    { key: 'posgradoFlacso', label: '¿Cursaste algún posgrado en FLACSO?', type: 'select', required: true, spreadsheetColumn: '¿Cursó posgrado en FLACSO?' },
    { key: 'posgradoCual', label: '¿Cuál posgrado?', type: 'text', required: false, spreadsheetColumn: 'Cuál posgrado' },
    { key: 'tituloDenominacion', label: 'Denominación del título', type: 'text', required: false, spreadsheetColumn: 'Denominación del título' },
    { key: 'sinTituloActual', label: 'No poseo actualmente título', type: 'checkbox', required: false, spreadsheetColumn: 'No posee actualmente título' },
    { key: 'orientacion', label: 'Orientación', type: 'select', required: true, spreadsheetColumn: 'Orientación' },
    { key: 'tieneConvenio', label: '¿Te corresponde algún convenio?', type: 'select', required: true, spreadsheetColumn: '¿Te corresponde algún convenio?' },
    { key: 'convenioWordpressId', label: '¿Cuál convenio?', type: 'text', required: false, spreadsheetColumn: 'Convenio' },
  ],
  documents: [
    { key: 'identidad', label: 'Documento de identidad', required: true },
    { key: 'cv', label: 'Curriculum Vitae', required: true },
    { key: 'titulo', label: 'Título de grado o terciario', required: true },
  ],
  orientations: ['Educación'],
  mentions: [],
  agreements: [{ id: '27120', label: 'Convenio FLACSO - Udelar' }],
  recommendationLettersCount: 0,
};

describe('spreadsheet schema', () => {
  it('generates headers with reordered document fields, phone country, fused gender/title, folder link and document columns', () => {
    const { headers } = buildSpreadsheetSchema(comprehensiveForm);

    expect(headers).toEqual([
      SPREADSHEET_TRACKING_COLUMN,
      SPREADSHEET_DATE_COLUMN,
      'Primer nombre',
      'Tipo de documento',
      'País emisor del documento',
      'Número de documento',
      'Identidad de género',
      'Celular',
      'País del celular',
      'Estudios cursados',
      'Posgrado en FLACSO',
      'Denominación del título',
      'Orientación',
      'Convenio',
      'Carpeta de documentos',
      'Documento de identidad',
      'Curriculum Vitae',
      'Título de grado o terciario',
    ]);

    // Ensure removed/collapsed columns are NOT present
    expect(headers).not.toContain('Especificación de identidad de género');
    expect(headers).not.toContain('No posee actualmente título');
    expect(headers).not.toContain('Cuál posgrado');
  });

  describe('extractPhoneCountryCode', () => {
    it('returns UY for Uruguayan local or international numbers', () => {
      expect(extractPhoneCountryCode('+598 99 123 456')).toBe('UY');
      expect(extractPhoneCountryCode('+59899123456')).toBe('UY');
      expect(extractPhoneCountryCode('099123456')).toBe('UY');
      expect(extractPhoneCountryCode('098765432')).toBe('UY');
    });

    it('returns international 2-letter country code for foreign numbers', () => {
      expect(extractPhoneCountryCode('+54 9 11 1234 5678')).toBe('AR');
      expect(extractPhoneCountryCode('+55 11 91234-5678')).toBe('BR');
      expect(extractPhoneCountryCode('+34 612 345 678')).toBe('ES');
    });

    it('returns empty string for empty input', () => {
      expect(extractPhoneCountryCode('')).toBe('');
    });
  });

  it('writes fused and enriched values including phone country and document hyperlinks', () => {
    const submittedAt = new Date('2026-10-05T12:00:00.000Z');
    const values = buildSpreadsheetValues(
      comprehensiveForm,
      {
        nombre1: 'María',
        tipoDocumento: 'cedula_uruguaya',
        paisEmisorDocumento: 'Uruguay',
        documento: '1.234.567-8',
        genero: 'Otra',
        generoOtra: 'No binario',
        celular: '+59899123456',
        estudios: 'Licenciatura en Educación',
        posgradoFlacso: 'Si',
        posgradoCual: 'Diploma en Género',
        tituloDenominacion: 'Licenciada en Educación',
        sinTituloActual: '',
        orientacion: 'Educación',
        tieneConvenio: 'Si',
        convenioWordpressId: '27120',
      },
      'sub_123',
      submittedAt,
      {
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-applicant-123',
        files: [
          { fieldKey: 'identidad', driveFileId: 'drive-id-1' },
          { fieldKey: 'identidad', driveFileId: 'drive-id-2' }, // 2 files -> links to folder
          { fieldKey: 'cv', driveFileId: 'drive-cv-1' }, // 1 file -> links to file
          { fieldKey: 'titulo', driveFileId: 'drive-tit-1' }, // 1 file -> links to file
        ],
      }
    );

    expect(values['ID de seguimiento']).toBe('sub_123');
    expect(values['Fecha de preinscripción']).toBe('2026-10-05T12:00:00.000Z');
    expect(values['País emisor del documento']).toBe('Uruguay');
    expect(values['Número de documento']).toBe('1.234.567-8');
    // Fused gender
    expect(values['Identidad de género']).toBe('No binario');
    // Phone country
    expect(values['Celular']).toBe('+59899123456');
    expect(values['País del celular']).toBe('UY');
    // Fused title
    expect(values['Denominación del título']).toBe('Licenciada en Educación');
    // Collapsed posgrado and convenio
    expect(values['Posgrado en FLACSO']).toBe('Diploma en Género');
    expect(values['Convenio']).toBe('Convenio FLACSO - Udelar');
    // Folder link
    expect(values['Carpeta de documentos']).toBe(
      '=HYPERLINK("https://drive.google.com/drive/folders/folder-applicant-123", "Abrir carpeta")'
    );
    // Document with 2 files references folder
    expect(values['Documento de identidad']).toBe(
      '=HYPERLINK("https://drive.google.com/drive/folders/folder-applicant-123", "Ver en carpeta")'
    );
    // Single-file documents reference file
    expect(values['Curriculum Vitae']).toBe(
      '=HYPERLINK("https://drive.google.com/file/d/drive-cv-1/view", "Ver archivo")'
    );
    expect(values['Título de grado o terciario']).toBe(
      '=HYPERLINK("https://drive.google.com/file/d/drive-tit-1/view", "Ver archivo")'
    );
  });

  it('handles standard gender without otra and title exception properly', () => {
    const values = buildSpreadsheetValues(
      comprehensiveForm,
      {
        nombre1: 'Carlos',
        genero: 'Varón',
        generoOtra: '',
        celular: '+5491112345678',
        sinTituloActual: 'Si',
        tituloDenominacion: '',
      },
      'sub_456',
      new Date('2026-10-05T12:00:00.000Z'),
      {
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-456',
        files: [],
      }
    );

    expect(values['Identidad de género']).toBe('Varón');
    expect(values['País del celular']).toBe('AR');
    expect(values['Denominación del título']).toBe('No posee actualmente título');
    expect(values['Título de grado o terciario']).toBe('No posee actualmente título');
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
