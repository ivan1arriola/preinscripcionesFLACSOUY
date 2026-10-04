import { describe, it, expect, vi } from 'vitest';
import {
  GoogleSheetsRepository,
  IncompatibleSpreadsheetError,
} from './google-sheets-repository.js';
import type { SheetsClient } from './sheets-client.js';

describe('GoogleSheetsRepository (Integration & Port Adapter)', () => {
  it('reads headers from the first row of the configured sheet', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre', 'Apellido', 'Correo electrónico']]),
      updateValues: vi.fn(),
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    const headers = await repo.readHeaders('sheet_123', 'Respuestas');

    expect(headers).toEqual(['Nombre', 'Apellido', 'Correo electrónico']);
    expect(mockClient.getValues).toHaveBeenCalledWith('sheet_123', 'Respuestas!1:1');
  });

  it('appends a row by header names and preserves manual columns as empty slots', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([
        ['Marca temporal', 'Observaciones Asistente', 'Nombre', 'Apellido', 'Documento'],
      ]),
      updateValues: vi.fn(),
      appendValues: vi.fn().mockResolvedValue({
        updatedRange: 'Respuestas!A5:E5',
        updatedRows: 1,
      }),
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

    expect(result.updatedRange).toBe('Respuestas!A5:E5');
    expect(result.updatedRows).toBe(1);

    expect(mockClient.appendValues).toHaveBeenCalledWith('sheet_123', 'Respuestas!A:A', [
      ['2026-10-02 12:00:00', '', 'Lucía', 'Pérez', '3.210.987-6'],
    ]);
  });

  it('repairs missing required columns additively preserving existing order and manual columns, then appends the complete row', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([
        ['Timestamp', 'Observaciones Asistente', 'Nombre', 'País de residencia'],
      ]),
      updateValues: vi.fn().mockResolvedValue(undefined),
      appendValues: vi.fn().mockResolvedValue({
        updatedRange: 'Inscripciones!A2:E2',
        updatedRows: 1,
      }),
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

    // Header row 1:1 updated additively with Ciudad de residencia at the end
    expect(mockClient.updateValues).toHaveBeenCalledWith(
      'sheet_123',
      'Inscripciones!1:1',
      [['Timestamp', 'Observaciones Asistente', 'Nombre', 'País de residencia', 'Ciudad de residencia']]
    );

    // Row appended using the updated header layout
    expect(mockClient.appendValues).toHaveBeenCalledWith(
      'sheet_123',
      'Inscripciones!A:A',
      [['2026-10-04 12:00:00', '', 'Carlos', 'Uruguay', 'Montevideo']]
    );

    expect(result.updatedRange).toBe('Inscripciones!A2:E2');
    expect(result.updatedRows).toBe(1);
  });

  it('fails safely without calling appendValues when updateValues is rejected during schema repair', async () => {
    const mockClient: SheetsClient = {
      getValues: vi.fn().mockResolvedValue([['Nombre', 'Documento']]), // Missing Apellido
      updateValues: vi.fn().mockRejectedValue(new Error('Permission denied on header write')),
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
      appendValues: vi.fn(),
    };

    const repo = new GoogleSheetsRepository(mockClient);
    const diag = await repo.diagnose('sheet_private', ['Nombre', 'Apellido']);

    expect(diag.accessible).toBe(false);
    expect(diag.sheetFound).toBe(false);
    expect(diag.headerDiagnostic.valid).toBe(false);
    expect(diag.error).toContain('Permission denied');
  });
});
