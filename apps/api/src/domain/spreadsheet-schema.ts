import type { AgreementOption, FormDefinition } from '@flacso/contracts';

export const SPREADSHEET_TRACKING_COLUMN = 'ID de seguimiento';
export const SPREADSHEET_DATE_COLUMN = 'Fecha de preinscripción';
export const SPREADSHEET_POSTGRADUATE_COLUMN = 'Posgrado en FLACSO';
export const SPREADSHEET_AGREEMENT_COLUMN = 'Convenio';

const COLLAPSED_INPUT_KEYS = new Set(['posgradoCual', 'convenioWordpressId']);

export interface SpreadsheetSchema {
  headers: string[];
  requiredColumns: string[];
}

export function buildSpreadsheetSchema(form: FormDefinition): SpreadsheetSchema {
  const headers = [SPREADSHEET_TRACKING_COLUMN, SPREADSHEET_DATE_COLUMN];
  const requiredColumns = [...headers];

  for (const input of form.inputs) {
    if (COLLAPSED_INPUT_KEYS.has(input.key)) continue;
    const column = spreadsheetColumnForInput(input.key, input.spreadsheetColumn ?? input.label);
    if (!headers.includes(column)) headers.push(column);
    if (input.required && !requiredColumns.includes(column)) requiredColumns.push(column);
  }

  return { headers, requiredColumns };
}

export function buildSpreadsheetValues(
  form: FormDefinition,
  normalizedValues: Record<string, string>,
  submissionId: string,
  submittedAt: Date = new Date(),
): Record<string, string> {
  const values: Record<string, string> = {
    [SPREADSHEET_TRACKING_COLUMN]: submissionId,
    [SPREADSHEET_DATE_COLUMN]: submittedAt.toISOString(),
  };

  for (const input of form.inputs) {
    if (COLLAPSED_INPUT_KEYS.has(input.key)) continue;
    const column = spreadsheetColumnForInput(input.key, input.spreadsheetColumn ?? input.label);
    if (input.key === 'posgradoFlacso') {
      values[column] = normalizedValues.posgradoFlacso === 'Si'
        ? normalizedValues.posgradoCual ?? ''
        : 'No';
      continue;
    }
    if (input.key === 'tieneConvenio') {
      values[column] = normalizedValues.tieneConvenio === 'Si'
        ? agreementLabel(normalizedValues.convenioWordpressId, form.agreements ?? [])
        : 'No';
      continue;
    }
    values[column] = normalizedValues[input.key] ?? '';
  }

  return values;
}

export function collapseLegacySpreadsheetRow(
  headers: string[],
  row: string[],
  targetHeaders: string[],
  agreements: AgreementOption[] = [],
): string[] {
  const legacy = new Map(headers.map((header, index) => [header.trim(), row[index] ?? '']));
  return targetHeaders.map((header) => {
    if (header === SPREADSHEET_POSTGRADUATE_COLUMN) {
      return legacy.get('¿Cursó posgrado en FLACSO?') === 'Si'
        ? legacy.get('Cuál posgrado') ?? ''
        : 'No';
    }
    if (header === SPREADSHEET_AGREEMENT_COLUMN) {
      return legacy.get('¿Te corresponde algún convenio?') === 'Si'
        ? agreementLabel(legacy.get('Convenio'), agreements)
        : 'No';
    }
    return legacy.get(header) ?? '';
  });
}

function spreadsheetColumnForInput(key: string, fallback: string): string {
  if (key === 'posgradoFlacso') return SPREADSHEET_POSTGRADUATE_COLUMN;
  if (key === 'tieneConvenio') return SPREADSHEET_AGREEMENT_COLUMN;
  return fallback;
}

function agreementLabel(id: string | undefined, agreements: AgreementOption[]): string {
  if (!id) return '';
  return agreements.find((agreement) => agreement.id === id)?.label ?? id;
}
