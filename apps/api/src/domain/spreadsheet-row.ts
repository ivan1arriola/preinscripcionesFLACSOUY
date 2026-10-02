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
