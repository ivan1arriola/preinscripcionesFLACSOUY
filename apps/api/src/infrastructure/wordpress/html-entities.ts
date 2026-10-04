const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  iquest: '¿',
  iexcl: '¡',
  copy: '©',
  reg: '®',
  deg: '°',
  bull: '•',
};

const isValidCodePoint = (codePoint: number): boolean => {
  return (
    Number.isInteger(codePoint) &&
    codePoint >= 0 &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
};

/**
 * Pura y acotada: decodifica entidades decimales, hexadecimales y nombradas
 * comunes generadas por WordPress en títulos institucionales.
 * Conserva referencias desconocidas o numéricamente inválidas sin lanzar.
 */
export function decodeHtmlEntities(raw: string): string {
  if (!raw || !raw.includes('&')) {
    return raw;
  }

  return raw.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z0-9]+));/g, (match, hex, dec, named) => {
    if (hex !== undefined) {
      const codePoint = parseInt(hex, 16);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (dec !== undefined) {
      const codePoint = parseInt(dec, 10);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (named !== undefined) {
      return NAMED_ENTITIES[named] ?? match;
    }

    return match;
  });
}
