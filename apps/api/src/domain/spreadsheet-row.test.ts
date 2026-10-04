import { describe, it, expect } from 'vitest';
import {
  buildSpreadsheetRow,
  validateSpreadsheetHeaders,
  resolveAdditiveHeaders,
  type RowBuildResult,
} from './spreadsheet-row.js';

describe('Spreadsheet Row Builder & Header Resolution (Pure Domain)', () => {
  it('maps values strictly by header name regardless of position', () => {
    // Reordered headers with a custom manual column inserted by administrative assistants
    const headers = [
      'Marca temporal',
      'Correo electrónico',
      'Observaciones Asistente', // Manual column added in Sheets
      'Apellido',
      'Nombre',
      'Documento',
      'Teléfono',
    ];

    const valuesByColumn: Record<string, string> = {
      'Marca temporal': '2026-10-02 01:00:00',
      'Nombre': 'Mariana',
      'Apellido': 'García',
      'Correo electrónico': 'mariana@example.com',
      'Teléfono': '099123456',
      'Documento': '4.876.543-2',
    };

    const requiredColumns = ['Nombre', 'Apellido', 'Correo electrónico', 'Documento'];

    const result: RowBuildResult = buildSpreadsheetRow(headers, valuesByColumn, requiredColumns);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.row).toEqual([
      '2026-10-02 01:00:00',
      'mariana@example.com',
      '', // Manual column preserved as empty string without overriding existing data
      'García',
      'Mariana',
      '4.876.543-2',
      '099123456',
    ]);
  });

  it('fails safely when required columns are missing in the spreadsheet headers', () => {
    const headers = ['Nombre', 'Correo electrónico']; // Missing 'Apellido' and 'Documento'
    const valuesByColumn = {
      'Nombre': 'Mariana',
      'Apellido': 'García',
      'Correo electrónico': 'mariana@example.com',
      'Documento': '4.876.543-2',
    };
    const requiredColumns = ['Nombre', 'Apellido', 'Correo electrónico', 'Documento'];

    const result = buildSpreadsheetRow(headers, valuesByColumn, requiredColumns);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.missingColumns).toEqual(['Apellido', 'Documento']);
  });

  it('validates headers and reports diagnostic of matching and missing columns', () => {
    const headers = ['Nombre', 'Apellido', 'Correo electrónico', 'Columna Extra'];
    const required = ['Nombre', 'Apellido', 'Correo electrónico', 'Documento'];

    const diag = validateSpreadsheetHeaders(headers, required);
    expect(diag.valid).toBe(false);
    expect(diag.foundColumns).toEqual(['Nombre', 'Apellido', 'Correo electrónico']);
    expect(diag.missingColumns).toEqual(['Documento']);
    expect(diag.extraColumns).toEqual(['Columna Extra']);
  });

  it('normalizes header names trimming whitespace for matching', () => {
    const headers = [' Nombre ', 'Apellido  ', ' Correo electrónico '];
    const required = ['Nombre', 'Apellido', 'Correo electrónico'];

    const diag = validateSpreadsheetHeaders(headers, required);
    expect(diag.valid).toBe(true);
    expect(diag.missingColumns).toEqual([]);
  });

  describe('resolveAdditiveHeaders (Pure Domain)', () => {
    it('appends missing required columns preserving the exact order of existing headers and manual columns', () => {
      const currentHeaders = ['Timestamp', 'Observaciones Asistente', 'Nombre', 'País de residencia'];
      const requiredColumns = ['Timestamp', 'Nombre', 'País de residencia', 'Ciudad de residencia'];

      const result = resolveAdditiveHeaders(currentHeaders, requiredColumns);

      expect(result.updatedHeaders).toEqual([
        'Timestamp',
        'Observaciones Asistente',
        'Nombre',
        'País de residencia',
        'Ciudad de residencia',
      ]);
      expect(result.missingColumnsAdded).toEqual(['Ciudad de residencia']);
    });

    it('does not duplicate columns if all required columns already exist', () => {
      const currentHeaders = ['Nombre', 'Apellido', 'Documento'];
      const requiredColumns = ['Nombre', 'Documento'];

      const result = resolveAdditiveHeaders(currentHeaders, requiredColumns);

      expect(result.updatedHeaders).toEqual(['Nombre', 'Apellido', 'Documento']);
      expect(result.missingColumnsAdded).toEqual([]);
    });
  });
});
