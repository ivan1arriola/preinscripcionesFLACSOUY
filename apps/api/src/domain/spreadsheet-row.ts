export interface SpreadsheetHeaderDiagnostic {
  valid: boolean;
  foundColumns: string[];
  missingColumns: string[];
  extraColumns: string[];
}

export type RowBuildResult =
  | {
      success: true;
      row: string[];
    }
  | {
      success: false;
      missingColumns: string[];
    };

function normalizeHeader(header: string): string {
  return header.trim();
}

export function validateSpreadsheetHeaders(
  headers: string[],
  requiredColumns: string[]
): SpreadsheetHeaderDiagnostic {
  const normalizedHeaders = headers.map(normalizeHeader);
  const headerSet = new Set(normalizedHeaders);

  const foundColumns: string[] = [];
  const missingColumns: string[] = [];

  for (const required of requiredColumns) {
    const norm = normalizeHeader(required);
    if (headerSet.has(norm)) {
      foundColumns.push(required);
    } else {
      missingColumns.push(required);
    }
  }

  const requiredSet = new Set(requiredColumns.map(normalizeHeader));
  const extraColumns = normalizedHeaders.filter((h) => h !== '' && !requiredSet.has(h));

  return {
    valid: missingColumns.length === 0,
    foundColumns,
    missingColumns,
    extraColumns,
  };
}

export function buildSpreadsheetRow(
  headers: string[],
  valuesByColumn: Record<string, string>,
  requiredColumns: string[]
): RowBuildResult {
  const diag = validateSpreadsheetHeaders(headers, requiredColumns);
  if (!diag.valid) {
    return {
      success: false,
      missingColumns: diag.missingColumns,
    };
  }

  // Create lookup map with trimmed keys
  const lookup: Record<string, string> = {};
  for (const [k, v] of Object.entries(valuesByColumn)) {
    lookup[normalizeHeader(k)] = v;
  }

  const row = headers.map((rawHeader) => {
    const key = normalizeHeader(rawHeader);
    return lookup[key] ?? '';
  });

  return {
    success: true,
    row,
  };
}

export function resolveAdditiveHeaders(
  currentHeaders: string[],
  requiredColumns: string[]
): {
  updatedHeaders: string[];
  missingColumnsAdded: string[];
} {
  const normalizedCurrent = currentHeaders.map((h) => h.trim());
  const currentSet = new Set(normalizedCurrent);
  const missingColumnsAdded: string[] = [];

  for (const col of requiredColumns) {
    if (!currentSet.has(col.trim())) {
      missingColumnsAdded.push(col);
    }
  }

  return {
    updatedHeaders: [...currentHeaders, ...missingColumnsAdded],
    missingColumnsAdded,
  };
}

export function buildSpreadsheetRowUrl(
  spreadsheetId: string,
  sheetId: number,
  updatedRange?: string
): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit#gid=${sheetId}`;
  if (!updatedRange || typeof updatedRange !== 'string') {
    return base;
  }

  const exclamationIdx = updatedRange.lastIndexOf('!');
  const cellRange = exclamationIdx >= 0 ? updatedRange.substring(exclamationIdx + 1).trim() : updatedRange.trim();

  if (/^[A-Za-z]+[0-9]+(?::[A-Za-z]+[0-9]+)?$/.test(cellRange)) {
    return `${base}&range=${cellRange}`;
  }

  return base;
}

