import { describe, expect, it } from 'vitest';
import { toCsv } from './csv.js';

describe('toCsv', () => {
  it('empieza con BOM y respeta el orden de la cabecera, con CRLF', () => {
    const csv = toCsv(['a', 'b'], [['1', '2']]);
    expect(csv).toBe('\uFEFFa,b\r\n1,2\r\n');
  });

  it('escapa comas, comillas y saltos de línea', () => {
    const csv = toCsv(['x'], [['a,b'], ['di "hola"'], ['l1\nl2'], [null]]);
    expect(csv).toBe('\uFEFFx\r\n"a,b"\r\n"di ""hola"""\r\n"l1\nl2"\r\n\r\n');
  });

  it('neutraliza fórmulas', () => {
    const csv = toCsv(['x'], [['=HYPERLINK("http://x","y")'], ['+1'], ['-2'], ['@x'], ['\tt'], ['ok']]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(lines.slice(2, 5)).toEqual([`'+1`, `'-2`, `'@x`]);
    expect(lines[5]).toBe(`'\tt`);
    expect(lines[6]).toBe('ok');
  });
});
