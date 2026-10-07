import { describe, expect, it, vi } from 'vitest';
import type { AcademicTarget, AgreementOption } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SheetsClient } from '../infrastructure/google/sheets-client.js';
import type { TargetSpreadsheetRepository } from '../ports/target-spreadsheet-repository.js';
import {
  migrateTargetSpreadsheets,
  type MigrationSubmissionData,
} from './migrate-target-spreadsheets.js';
import {
  SPREADSHEET_TRACKING_COLUMN,
  SPREADSHEET_DATE_COLUMN,
  SPREADSHEET_PHONE_COUNTRY_COLUMN,
  SPREADSHEET_DOCUMENTS_FOLDER_COLUMN,
} from '../domain/spreadsheet-schema.js';

describe('migrateTargetSpreadsheets', () => {
  const sampleTarget: AcademicTarget = {
    id: 'diplomado-salud-c2',
    kind: 'academic_offer',
    title: 'Diploma en Salud y Sociedad',
    offerType: 'diplomado',
    registrationOpen: true,
    configRevision: 'rev-1',
    orientations: [],
    mentions: [],
  };

  const sampleAgreements: AgreementOption[] = [
    { id: '27120', label: 'Convenio FLACSO - Udelar' },
  ];

  it('migrates a target spreadsheet enriching DB submissions with Drive links and transformed fields', async () => {
    const oldHeaders = [
      SPREADSHEET_TRACKING_COLUMN,
      SPREADSHEET_DATE_COLUMN,
      'Primer nombre',
      'Tipo de documento',
      'Número de documento',
      'País emisor del documento',
      'Identidad de género',
      'Especificación de identidad de género',
      'Celular',
      'Estudios cursados',
      '¿Cursó posgrado en FLACSO?',
      'Cuál posgrado',
      'Denominación del título',
      'No posee actualmente título',
      '¿Te corresponde algún convenio?',
      'Convenio',
    ];

    const oldDataRow = [
      'sub-101',
      '2026-10-01T10:00:00.000Z',
      'Lucía',
      'cedula_uruguaya',
      '1.234.567-8',
      'Uruguay',
      'Otra',
      'No binario',
      '+598 99 123 456',
      'Universidad',
      'Si',
      'Diploma en Género',
      'Licenciatura en Psicología',
      'No',
      'Si',
      '27120',
    ];

    const targetRepo: TargetSpreadsheetRepository = {
      ensureTarget: vi.fn(),
      get: vi.fn(),
      list: vi.fn(async () => [
        {
          targetId: 'diplomado-salud-c2',
          spreadsheetId: 'sheet-abc',
          sheetName: 'Preinscripciones',
        },
      ]),
      save: vi.fn(),
    };

    const catalog: AcademicCatalog = {
      listTargets: vi.fn(async () => [sampleTarget]),
      getTarget: vi.fn(async () => sampleTarget),
      revalidateTarget: vi.fn(async () => sampleTarget),
      revalidateTargets: vi.fn(async () => [sampleTarget]),
      listAgreements: vi.fn(async () => sampleAgreements),
    };

    let updatedRange: string | undefined;
    let updatedValues: string[][] = [];

    const mockSheetsClient: SheetsClient = {
      getValues: vi.fn(async (_id, _range) => [oldHeaders, oldDataRow]),
      updateValues: vi.fn(async (_id, range, values) => {
        updatedRange = range;
        updatedValues = values;
      }),
      clearValues: vi.fn(async () => {}),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };

    const dbSubmissions: MigrationSubmissionData[] = [
      {
        id: 'sub-101',
        submittedAt: new Date('2026-10-01T10:00:00.000Z'),
        values: {
          nombre1: 'Lucía',
          tipoDocumento: 'cedula_uruguaya',
          documento: '1.234.567-8',
          paisEmisorDocumento: 'Uruguay',
          genero: 'Otra',
          generoOtra: 'No binario',
          celular: '+598 99 123 456',
          estudios: 'Universidad',
          posgradoFlacso: 'Si',
          posgradoCual: 'Diploma en Género',
          tituloDenominacion: 'Licenciatura en Psicología',
          sinTituloActual: '',
          tieneConvenio: 'Si',
          convenioWordpressId: '27120',
        },
        files: [
          { fieldKey: 'identidad', token: 'tok_id_1', driveFileId: 'drive-file-id-1' },
          { fieldKey: 'cv', token: 'tok_cv_1', driveFileId: 'drive-file-cv-1' },
          { fieldKey: 'titulo', token: 'tok_tit_1', driveFileId: 'drive-file-tit-1' },
        ],
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-sub-101',
      },
    ];

    const result = await migrateTargetSpreadsheets({
      targetSpreadsheetRepository: targetRepo,
      catalog,
      sheetsClient: mockSheetsClient,
      getSubmissionsForTarget: vi.fn(async () => dbSubmissions),
    });

    expect(result.targetsProcessed).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(result.results[0]!.matchedDbSubmissions).toBe(1);
    expect(result.results[0]!.totalRows).toBe(1);

    expect(mockSheetsClient.updateValues).toHaveBeenCalled();
    expect(updatedRange).toBe('Preinscripciones!A1');
    const newHeaders = updatedValues[0]!;
    const newRow = updatedValues[1]!;

    // Check header order
    expect(newHeaders).toContain('País emisor del documento');
    expect(newHeaders).toContain('Número de documento');
    const paisDocIdx = newHeaders.indexOf('País emisor del documento');
    const numDocIdx = newHeaders.indexOf('Número de documento');
    expect(paisDocIdx).toBeLessThan(numDocIdx);

    // Check phone country column
    expect(newHeaders).toContain(SPREADSHEET_PHONE_COUNTRY_COLUMN);
    const phoneCountryIdx = newHeaders.indexOf(SPREADSHEET_PHONE_COUNTRY_COLUMN);
    expect(newRow[phoneCountryIdx]).toBe('UY');

    // Check fused gender
    const genderIdx = newHeaders.indexOf('Identidad de género');
    expect(newRow[genderIdx]).toBe('No binario');

    // Check fused postgraduate
    const posgradoIdx = newHeaders.indexOf('Posgrado en FLACSO');
    expect(newRow[posgradoIdx]).toBe('Diploma en Género');

    // Check Drive folder hyperlink
    const folderIdx = newHeaders.indexOf(SPREADSHEET_DOCUMENTS_FOLDER_COLUMN);
    expect(newRow[folderIdx]).toBe(
      '=HYPERLINK("https://drive.google.com/drive/folders/folder-sub-101", "Abrir carpeta")'
    );

    // Check document hyperlink
    const cvIdx = newHeaders.indexOf('Curriculum Vitae');
    expect(newRow[cvIdx]).toBe(
      '=HYPERLINK("https://drive.google.com/file/d/drive-file-cv-1/view", "Ver archivo")'
    );
  });

  it('preserves manual rows not found in DB transforming legacy columns to new format', async () => {
    const oldHeaders = [
      SPREADSHEET_TRACKING_COLUMN,
      'Primer nombre',
      'Número de documento',
      'País emisor del documento',
      'Identidad de género',
      'Especificación de identidad de género',
      'Celular',
      'Denominación del título',
      'No posee actualmente título',
    ];

    const manualRow = [
      'sub-manual-999',
      'Esteban',
      '4.567.890-1',
      'Uruguay',
      'Varón',
      '',
      '+54 9 11 1234 5678',
      '',
      'Si',
    ];

    const targetRepo: TargetSpreadsheetRepository = {
      ensureTarget: vi.fn(),
      get: vi.fn(),
      list: vi.fn(async () => [
        {
          targetId: 'diplomado-salud-c2',
          spreadsheetId: 'sheet-abc',
          sheetName: 'Preinscripciones',
        },
      ]),
      save: vi.fn(),
    };

    const catalog: AcademicCatalog = {
      listTargets: vi.fn(async () => [sampleTarget]),
      getTarget: vi.fn(async () => sampleTarget),
      revalidateTarget: vi.fn(async () => sampleTarget),
      revalidateTargets: vi.fn(async () => [sampleTarget]),
      listAgreements: vi.fn(async () => []),
    };

    let updatedValues: string[][] = [];

    const mockSheetsClient: SheetsClient = {
      getValues: vi.fn(async () => [oldHeaders, manualRow]),
      updateValues: vi.fn(async (_id, _range, values) => {
        updatedValues = values;
      }),
      clearValues: vi.fn(async () => {}),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };

    const result = await migrateTargetSpreadsheets({
      targetSpreadsheetRepository: targetRepo,
      catalog,
      sheetsClient: mockSheetsClient,
      getSubmissionsForTarget: vi.fn(async () => []), // No DB submissions
    });

    expect(result.results[0]!.matchedDbSubmissions).toBe(0);
    expect(result.results[0]!.manualRowsPreserved).toBe(1);

    const newHeaders = updatedValues[0]!;
    const newRow = updatedValues[1]!;

    const trackingIdx = newHeaders.indexOf(SPREADSHEET_TRACKING_COLUMN);
    expect(newRow[trackingIdx]).toBe('sub-manual-999');

    const nameIdx = newHeaders.indexOf('Primer nombre');
    expect(newRow[nameIdx]).toBe('Esteban');

    // Phone country should be computed as AR
    const phoneCountryIdx = newHeaders.indexOf(SPREADSHEET_PHONE_COUNTRY_COLUMN);
    expect(newRow[phoneCountryIdx]).toBe('AR');

    // Title should be collapsed to "No posee actualmente título"
    const titleIdx = newHeaders.indexOf('Denominación del título');
    expect(newRow[titleIdx]).toBe('No posee actualmente título');
  });

  it('dryRun: true previews migration without calling updateValues or clearValues', async () => {
    const targetRepo: TargetSpreadsheetRepository = {
      ensureTarget: vi.fn(),
      get: vi.fn(),
      list: vi.fn(async () => [
        {
          targetId: 'diplomado-salud-c2',
          spreadsheetId: 'sheet-abc',
          sheetName: 'Preinscripciones',
        },
      ]),
      save: vi.fn(),
    };

    const catalog: AcademicCatalog = {
      listTargets: vi.fn(async () => [sampleTarget]),
      getTarget: vi.fn(async () => sampleTarget),
      revalidateTarget: vi.fn(async () => sampleTarget),
      revalidateTargets: vi.fn(async () => [sampleTarget]),
      listAgreements: vi.fn(async () => []),
    };

    const mockSheetsClient: SheetsClient = {
      getValues: vi.fn(async () => [['ID de seguimiento'], ['sub-1']]),
      updateValues: vi.fn(),
      clearValues: vi.fn(),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };

    const result = await migrateTargetSpreadsheets(
      {
        targetSpreadsheetRepository: targetRepo,
        catalog,
        sheetsClient: mockSheetsClient,
        getSubmissionsForTarget: vi.fn(async () => []),
      },
      { dryRun: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.results[0]!.totalRows).toBe(1);
    expect(mockSheetsClient.updateValues).not.toHaveBeenCalled();
    expect(mockSheetsClient.clearValues).not.toHaveBeenCalled();
  });
});
