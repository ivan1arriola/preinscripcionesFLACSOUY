import type { AgreementOption, FormDefinition } from '@flacso/contracts';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export const SPREADSHEET_TRACKING_COLUMN = 'ID de seguimiento';
export const SPREADSHEET_DATE_COLUMN = 'Fecha de preinscripción';
export const SPREADSHEET_POSTGRADUATE_COLUMN = 'Posgrado en FLACSO';
export const SPREADSHEET_AGREEMENT_COLUMN = 'Convenio';
export const SPREADSHEET_PHONE_COUNTRY_COLUMN = 'País del celular';
export const SPREADSHEET_DOCUMENTS_FOLDER_COLUMN = 'Carpeta de documentos';

const COLLAPSED_INPUT_KEYS = new Set(['posgradoCual', 'convenioWordpressId', 'generoOtra', 'sinTituloActual']);

export interface SpreadsheetSchema {
  headers: string[];
  requiredColumns: string[];
}

export interface SpreadsheetDriveFileRef {
  fieldKey?: string;
  token?: string;
  driveFileId?: string;
}

export interface SpreadsheetDriveContext {
  documentsFolderUrl?: string;
  files?: SpreadsheetDriveFileRef[];
}

export function extractPhoneCountryCode(celular: string): string {
  const trimmed = celular?.trim();
  if (!trimmed) return '';
  const parsed = parsePhoneNumberFromString(trimmed, 'UY');
  return parsed?.country ?? '';
}

export function formatDriveFolderHyperlink(folderUrl: string, label = 'Abrir carpeta'): string {
  return `=HYPERLINK("${folderUrl}"; "${label}")`;
}

export function formatDriveFileHyperlink(fileId: string, label = 'Ver archivo'): string {
  return `=HYPERLINK("https://drive.google.com/file/d/${fileId}/view"; "${label}")`;
}

export function buildSpreadsheetSchema(form: FormDefinition): SpreadsheetSchema {
  const headers = [SPREADSHEET_TRACKING_COLUMN, SPREADSHEET_DATE_COLUMN];
  const requiredColumns = [...headers];

  for (const input of form.inputs) {
    if (COLLAPSED_INPUT_KEYS.has(input.key)) continue;
    const column = spreadsheetColumnForInput(input.key, input.spreadsheetColumn ?? input.label);
    if (!headers.includes(column)) headers.push(column);
    if (input.required && !requiredColumns.includes(column)) requiredColumns.push(column);

    if (input.key === 'celular') {
      if (!headers.includes(SPREADSHEET_PHONE_COUNTRY_COLUMN)) {
        headers.push(SPREADSHEET_PHONE_COUNTRY_COLUMN);
      }
      if (input.required && !requiredColumns.includes(SPREADSHEET_PHONE_COUNTRY_COLUMN)) {
        requiredColumns.push(SPREADSHEET_PHONE_COUNTRY_COLUMN);
      }
    }
  }

  if ((form.documents ?? []).length > 0) {
    if (!headers.includes(SPREADSHEET_DOCUMENTS_FOLDER_COLUMN)) {
      headers.push(SPREADSHEET_DOCUMENTS_FOLDER_COLUMN);
    }
    for (const doc of form.documents ?? []) {
      const docColumn = doc.label;
      if (!headers.includes(docColumn)) headers.push(docColumn);
      if (doc.required && !requiredColumns.includes(docColumn)) requiredColumns.push(docColumn);
    }
  }

  return { headers, requiredColumns };
}

export function buildSpreadsheetValues(
  form: FormDefinition,
  normalizedValues: Record<string, string>,
  submissionId: string,
  submittedAt: Date = new Date(),
  driveContext?: SpreadsheetDriveContext,
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
    if (input.key === 'genero') {
      const isOtra = normalizedValues.genero === 'Otra';
      values[column] = isOtra && normalizedValues.generoOtra?.trim()
        ? normalizedValues.generoOtra.trim()
        : (normalizedValues.genero ?? '');
      continue;
    }
    if (input.key === 'tituloDenominacion') {
      const sinTitulo = normalizedValues.sinTituloActual === 'Si' || normalizedValues.sinTituloActual === 'true';
      values[column] = sinTitulo
        ? 'No posee actualmente título'
        : (normalizedValues.tituloDenominacion ?? '');
      continue;
    }
    if (input.key === 'celular') {
      values[column] = normalizedValues.celular ?? '';
      values[SPREADSHEET_PHONE_COUNTRY_COLUMN] = extractPhoneCountryCode(normalizedValues.celular ?? '');
      continue;
    }
    values[column] = normalizedValues[input.key] ?? '';
  }

  if (!values[SPREADSHEET_PHONE_COUNTRY_COLUMN] && normalizedValues.celular) {
    values[SPREADSHEET_PHONE_COUNTRY_COLUMN] = extractPhoneCountryCode(normalizedValues.celular);
  }

  if (driveContext?.documentsFolderUrl) {
    values[SPREADSHEET_DOCUMENTS_FOLDER_COLUMN] = formatDriveFolderHyperlink(
      driveContext.documentsFolderUrl,
      'Abrir carpeta'
    );
  } else {
    values[SPREADSHEET_DOCUMENTS_FOLDER_COLUMN] = '';
  }

  const files = driveContext?.files ?? [];
  const sinTitulo = normalizedValues.sinTituloActual === 'Si' || normalizedValues.sinTituloActual === 'true';

  for (const doc of form.documents ?? []) {
    const docFiles = files.filter((f) => f.fieldKey === doc.key && Boolean(f.driveFileId));

    if (doc.key === 'titulo' && docFiles.length === 0 && sinTitulo) {
      values[doc.label] = 'No posee actualmente título';
      continue;
    }

    const firstDocFile = docFiles[0];
    if (docFiles.length === 1 && firstDocFile?.driveFileId) {
      values[doc.label] = formatDriveFileHyperlink(firstDocFile.driveFileId, 'Ver archivo');
    } else if (docFiles.length > 1) {
      if (driveContext?.documentsFolderUrl) {
        values[doc.label] = formatDriveFolderHyperlink(driveContext.documentsFolderUrl, 'Ver en carpeta');
      } else {
        values[doc.label] = `${docFiles.length} archivos`;
      }
    } else {
      values[doc.label] = '';
    }
  }

  // Las planillas se escriben con USER_ENTERED: todo texto del postulante que Sheets pudiera evaluar como
  // fórmula o reinterpretar como número se guarda como texto literal. Sólo se respetan los hipervínculos
  // que genera el propio sistema en las columnas de documentos.
  const hyperlinkColumns = new Set([
    SPREADSHEET_DOCUMENTS_FOLDER_COLUMN,
    ...(form.documents ?? []).map((doc) => doc.label),
  ]);
  for (const [column, value] of Object.entries(values)) {
    if (hyperlinkColumns.has(column) && value.startsWith('=HYPERLINK(')) continue;
    values[column] = escapeSheetText(value);
  }

  return values;
}

const SHEET_FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const SHEET_LEADING_ZERO_NUMBER = /^0\d+$/;

/** Evita la inyección de fórmulas y la pérdida del `+` o de ceros a la izquierda al usar USER_ENTERED. */
export function escapeSheetText(value: string): string {
  if (!value) return value;
  return SHEET_FORMULA_TRIGGER.test(value) || SHEET_LEADING_ZERO_NUMBER.test(value) ? `'${value}` : value;
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
      // Una hoja que ya tiene la columna consolidada y no la pregunta legacy no debe perder sus valores.
      if (!legacy.has('¿Cursó posgrado en FLACSO?')) return legacy.get(header) ?? '';
      return legacy.get('¿Cursó posgrado en FLACSO?') === 'Si'
        ? legacy.get('Cuál posgrado') ?? ''
        : 'No';
    }
    if (header === SPREADSHEET_AGREEMENT_COLUMN) {
      if (!legacy.has('¿Te corresponde algún convenio?')) return legacy.get(header) ?? '';
      return legacy.get('¿Te corresponde algún convenio?') === 'Si'
        ? agreementLabel(legacy.get('Convenio'), agreements)
        : 'No';
    }
    if (header === 'Identidad de género') {
      const rawGender = legacy.get('Identidad de género') ?? '';
      const specificGender = legacy.get('Especificación de identidad de género')
        ?? legacy.get('Especifique su identidad de género')
        ?? '';
      if (rawGender === 'Otra' && specificGender.trim()) {
        return specificGender.trim();
      }
      return rawGender;
    }
    if (header === 'Denominación del título') {
      const sinTitulo = legacy.get('No posee actualmente título') ?? '';
      if (sinTitulo === 'Si' || sinTitulo === 'true') {
        return 'No posee actualmente título';
      }
      return legacy.get('Denominación del título') ?? '';
    }
    if (header === SPREADSHEET_PHONE_COUNTRY_COLUMN) {
      const existing = legacy.get(SPREADSHEET_PHONE_COUNTRY_COLUMN);
      if (existing) return existing;
      const celular = legacy.get('Celular') ?? '';
      return extractPhoneCountryCode(celular);
    }
    const rawVal = legacy.get(header) ?? '';
    if (rawVal.startsWith('=HYPERLINK(')) {
      return rawVal.replace(/,\s*"/g, '; "');
    }
    return rawVal;
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
