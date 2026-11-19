const BOM = '\uFEFF';

/** Evita que una planilla interprete el texto del postulante como fórmula (=, +, -, @, TAB, CR). */
function neutralize(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** CSV RFC 4180 con BOM UTF-8 (Excel) y fin de línea CRLF. La cabecera no pasa por la neutralización. */
export function toCsv(header: string[], rows: Array<Array<string | null | undefined>>): string {
  const lines = [header.map(quote), ...rows.map((row) => row.map((cell) => quote(neutralize(cell ?? ''))))];
  return BOM + lines.map((line) => line.join(',')).join('\r\n') + '\r\n';
}
