import { describe, it, expect, vi } from 'vitest';
import {
  GoogleSheetsRepository,
  IncompatibleSpreadsheetError,
} from './google-sheets-repository.js';
import { type SheetsClient, buildSpreadsheetRowUrl } from './sheets-client.js';

describe('GoogleSheetsRepository (Integration & Port Adapter)', () => {
  it('reads headers from the first row of the configured sheet', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre', 'Apellido', 'Correo electrónico']]),
      updateValues: vi.fn(),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    const headers = await repo.readHeaders('sheet_123', 'Respuestas');

    expect(headers).toEqual(['Nombre', 'Apellido', 'Correo electrónico']);
    expect(mockClient.getValues).toHaveBeenCalledWith('sheet_123', 'Respuestas!A1:ZZ1');
  });

  it('quotes sheet names with spaces so Google Sheets accepts the A1 range', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre']]),
      updateValues: vi.fn(),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    await repo.readHeaders('sheet_123', 'Hoja 1');

    expect(mockClient.getValues).toHaveBeenCalledWith('sheet_123', "'Hoja 1'!A1:ZZ1");
  });

  it('uses the actual first sheet title when the configured title is stale', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre']]),
      updateValues: vi.fn(),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
      getSheetMetadata: vi.fn().mockResolvedValue({
        sheetId: 0,
        title: 'Hoja 1',
        index: 0,
      }),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    await repo.readHeaders('sheet_123', 'Inscripciones');

    expect(mockClient.getSheetMetadata).toHaveBeenCalledWith('sheet_123', 'Inscripciones');
    expect(mockClient.getValues).toHaveBeenCalledWith('sheet_123', "'Hoja 1'!A1:ZZ1");
  });

  it('inserts a row below the header by header names and preserves manual columns as empty slots', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([
        ['Marca temporal', 'Observaciones Asistente', 'Nombre', 'Apellido', 'Documento'],
      ]),
      updateValues: vi.fn(),
      insertRows: vi.fn().mockResolvedValue(undefined),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);

    const result = await repo.appendByHeaders(
      'sheet_123',
      {
        'Marca temporal': '2026-10-02 12:00:00',
        'Nombre': 'Lucía',
        'Apellido': 'Pérez',
        'Documento': '3.210.987-6',
      },
      ['Nombre', 'Apellido', 'Documento'],
      'Respuestas'
    );

    expect(result.updatedRange).toBe('Respuestas!A2:E2');
    expect(result.updatedRows).toBe(1);
    expect(result.sheetName).toBe('Respuestas');
    expect(result.sheetId).toBe(0);
    expect(result.rowUrl).toBe('https://docs.google.com/spreadsheets/d/sheet_123/edit#gid=0&range=A2:E2');

    expect(mockClient.insertRows).toHaveBeenCalledWith('sheet_123', 0, 1, 2);
    expect(mockClient.updateValues).toHaveBeenCalledWith('sheet_123', 'Respuestas!A2:E2', [
      ['2026-10-02 12:00:00', '', 'Lucía', 'Pérez', '3.210.987-6'],
    ], 'USER_ENTERED');
    expect(mockClient.appendValues).not.toHaveBeenCalled();
  });

  it('serializes concurrent appends so two applicants never write to the same row', async () => {
    const calls: string[] = [];
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre']]),
      insertRows: vi.fn(async () => {
        calls.push('insert');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
      updateValues: vi.fn(async (_id: string, _range: string, values: string[][]) => {
        calls.push(`write:${values[0]?.[0]}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    await Promise.all([
      repo.appendByHeaders('sheet_123', { Nombre: 'Ana' }, ['Nombre']),
      repo.appendByHeaders('sheet_123', { Nombre: 'Beto' }, ['Nombre']),
    ]);

    // Cada postulante inserta y escribe su fila antes de que empiece el siguiente.
    expect(calls).toEqual(['insert', 'write:Ana', 'insert', 'write:Beto']);
  });

  it('resolves real sheetId from getSheetMetadata and constructs accurate direct row URL', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre', 'Documento']]),
      updateValues: vi.fn(),
      insertRows: vi.fn().mockResolvedValue(undefined),
      appendValues: vi.fn(),
      getSheetMetadata: vi.fn().mockResolvedValue({
        sheetId: 987654321,
        title: 'Inscripciones 2026',
        index: 1,
      }),
    };

    const repo = new GoogleSheetsRepository(mockClient);

    const result = await repo.appendByHeaders(
      'sheet_custom_id',
      { Nombre: 'Juan', Documento: '1234' },
      ['Nombre', 'Documento'],
      'Inscripciones 2026'
    );

    expect(result.sheetId).toBe(987654321);
    expect(result.sheetName).toBe('Inscripciones 2026');
    expect(result.rowUrl).toBe(
      'https://docs.google.com/spreadsheets/d/sheet_custom_id/edit#gid=987654321&range=A2:B2'
    );
  });

  it('repairs missing required columns additively preserving existing order and manual columns, then appends the complete row', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([
        ['Timestamp', 'Observaciones Asistente', 'Nombre', 'País de residencia'],
      ]),
      updateValues: vi.fn().mockResolvedValue(undefined),
      insertRows: vi.fn().mockResolvedValue(undefined),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);

    const result = await repo.appendByHeaders(
      'sheet_123',
      {
        'Timestamp': '2026-10-04 12:00:00',
        'Nombre': 'Carlos',
        'País de residencia': 'Uruguay',
        'Ciudad de residencia': 'Montevideo',
      },
      ['Timestamp', 'Nombre', 'País de residencia', 'Ciudad de residencia'],
      'Inscripciones'
    );

    // Header row A1:ZZ1 updated additively with Ciudad de residencia at the end
    expect(mockClient.updateValues).toHaveBeenCalledWith(
      'sheet_123',
      'Inscripciones!A1:ZZ1',
      [['Timestamp', 'Observaciones Asistente', 'Nombre', 'País de residencia', 'Ciudad de residencia']]
    );

    // Row inserted below the header using the updated header layout
    expect(mockClient.insertRows).toHaveBeenCalledWith('sheet_123', 0, 1, 2);
    expect(mockClient.updateValues).toHaveBeenLastCalledWith(
      'sheet_123',
      'Inscripciones!A2:E2',
      [['2026-10-04 12:00:00', '', 'Carlos', 'Uruguay', 'Montevideo']],
      'USER_ENTERED',
    );

    expect(result.updatedRange).toBe('Inscripciones!A2:E2');
    expect(result.updatedRows).toBe(1);
  });

  it('fails safely without calling appendValues when updateValues is rejected during schema repair', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre', 'Documento']]), // Missing Apellido
      updateValues: vi.fn().mockRejectedValue(new Error('Permission denied on header write')),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);

    await expect(
      repo.appendByHeaders(
        'sheet_123',
        { Nombre: 'Lucía', Apellido: 'Pérez', Documento: '123' },
        ['Nombre', 'Apellido', 'Documento']
      )
    ).rejects.toThrow(IncompatibleSpreadsheetError);

    expect(mockClient.updateValues).toHaveBeenCalled();
    expect(mockClient.appendValues).not.toHaveBeenCalled();
  });

  it('diagnoses spreadsheet accessibility and missing columns safely', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre', 'Apellido', 'Columna Extra']]),
      updateValues: vi.fn(),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    const diag = await repo.diagnose('sheet_123', ['Nombre', 'Apellido', 'Documento']);

    expect(diag.accessible).toBe(true);
    expect(diag.sheetFound).toBe(true);
    expect(diag.headerDiagnostic.valid).toBe(false);
    expect(diag.headerDiagnostic.missingColumns).toEqual(['Documento']);
    expect(diag.headerDiagnostic.extraColumns).toEqual(['Columna Extra']);
  });

  it('returns safe diagnostic report when spreadsheet is inaccessible', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockRejectedValue(new Error('Permission denied')),
      updateValues: vi.fn(),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    const diag = await repo.diagnose('sheet_private', ['Nombre', 'Apellido']);

    expect(diag.accessible).toBe(false);
    expect(diag.sheetFound).toBe(false);
    expect(diag.headerDiagnostic.valid).toBe(false);
    expect(diag.error).toContain('Permission denied');
  });

  describe('buildSpreadsheetRowUrl', () => {
    it('constructs direct row URL for sheets with normal names, names with spaces, and cell ranges', () => {
      expect(buildSpreadsheetRowUrl('sheet_123', 0, 'Inscripciones!A5:Z5')).toBe(
        'https://docs.google.com/spreadsheets/d/sheet_123/edit#gid=0&range=A5:Z5'
      );

      expect(buildSpreadsheetRowUrl('sheet_abc', 45678, "'Inscripciones 2026'!A2:Z2")).toBe(
        'https://docs.google.com/spreadsheets/d/sheet_abc/edit#gid=45678&range=A2:Z2'
      );

      expect(buildSpreadsheetRowUrl('sheet_xyz', 99, 'A10:E10')).toBe(
        'https://docs.google.com/spreadsheets/d/sheet_xyz/edit#gid=99&range=A10:E10'
      );
    });

    it('falls back to spreadsheet sheet URL when range is unexpected or invalid', () => {
      expect(buildSpreadsheetRowUrl('sheet_123', 101, 'invalid-range-format')).toBe(
        'https://docs.google.com/spreadsheets/d/sheet_123/edit#gid=101'
      );

      expect(buildSpreadsheetRowUrl('sheet_123', 101, undefined)).toBe(
        'https://docs.google.com/spreadsheets/d/sheet_123/edit#gid=101'
      );
    });
  });

  it('appendByHeaders resolves sheetId from metadata and returns rowUrl in AppendResult', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre', 'Documento']]),
      updateValues: vi.fn(),
      insertRows: vi.fn().mockResolvedValue(undefined),
      appendValues: vi.fn(),
      getSheetMetadata: vi.fn().mockResolvedValue({
        sheetId: 78910,
        title: 'Inscripciones',
        index: 1,
      }),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    const result = await repo.appendByHeaders(
      'sheet_meta_1',
      { Nombre: 'María', Documento: '4.567.890-1' },
      ['Nombre', 'Documento'],
      'Inscripciones'
    );

    expect(result.spreadsheetId).toBe('sheet_meta_1');
    expect(result.sheetName).toBe('Inscripciones');
    expect(result.sheetId).toBe(78910);
    expect(result.updatedRange).toBe('Inscripciones!A2:B2');
    expect(result.rowUrl).toBe('https://docs.google.com/spreadsheets/d/sheet_meta_1/edit#gid=78910&range=A2:B2');
    expect(result.updatedRows).toBe(1);
    expect(mockClient.insertRows).toHaveBeenCalledWith('sheet_meta_1', 78910, 1, 2);
    expect(mockClient.getSheetMetadata).toHaveBeenCalledWith('sheet_meta_1', 'Inscripciones');
  });

  it('migrates existing rows to the target schema and clears obsolete columns', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([
        ['Nombre', '¿Cursó posgrado en FLACSO?', 'Cuál posgrado', '¿Te corresponde algún convenio?', 'Convenio', 'Columna obsoleta'],
        ['Iván', 'Si', 'Maestría en Educación', 'Si', 'Convenio FLACSO - Udelar', 'legacy'],
        ['Ana', 'No', '', 'No', '', 'legacy'],
      ]),
      updateValues: vi.fn().mockResolvedValue(undefined),
      clearValues: vi.fn().mockResolvedValue(undefined),
      insertRows: vi.fn(),
      appendValues: vi.fn(),
    };
    const repo = new GoogleSheetsRepository(mockClient);

    await repo.synchronizeSchema!('sheet_123', 'Inscripciones', [
      'ID de seguimiento',
      'Fecha de preinscripción',
      'Nombre',
      'Posgrado en FLACSO',
      'Convenio',
    ]);

    expect(mockClient.updateValues).toHaveBeenCalledWith(
      'sheet_123',
      'Inscripciones!A1:E3',
      [
        ['ID de seguimiento', 'Fecha de preinscripción', 'Nombre', 'Posgrado en FLACSO', 'Convenio'],
        ['', '', 'Iván', 'Maestría en Educación', 'Convenio FLACSO - Udelar'],
        ['', '', 'Ana', 'No', 'No'],
      ],
      'USER_ENTERED',
    );
    expect(mockClient.clearValues).toHaveBeenCalledWith('sheet_123', 'Inscripciones!F1:F3');
  });
});
