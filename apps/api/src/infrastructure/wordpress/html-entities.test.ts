import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from './html-entities.js';

describe('decodeHtmlEntities', () => {
  it('decodes decimal numeric entities like &#8211; and &#243;', () => {
    expect(decodeHtmlEntities('Ant&#237;gona &#8211; Asociaci&#243;n Civil')).toBe('Antígona – Asociación Civil');
  });

  it('decodes hexadecimal numeric entities like &#x2013;', () => {
    expect(decodeHtmlEntities('Convenio FLACSO &#x2013; Udelar')).toBe('Convenio FLACSO – Udelar');
  });

  it('decodes standard named entities like &amp; and &quot;', () => {
    expect(decodeHtmlEntities('&quot;Educaci&oacute;n &amp; Sociedad&quot;')).toBe('"Educación & Sociedad"');
  });

  it('returns text unchanged when there are no entities', () => {
    expect(decodeHtmlEntities('Texto plano sin entidades')).toBe('Texto plano sin entidades');
  });

  it('preserves unknown named entities without throwing', () => {
    expect(decodeHtmlEntities('Prueba &entidadDesconocida; intacta')).toBe('Prueba &entidadDesconocida; intacta');
  });

  it('preserves invalid numeric references without throwing', () => {
    // 0x110000 is beyond max Unicode code point (0x10FFFF)
    expect(decodeHtmlEntities('Invalido &#999999999;')).toBe('Invalido &#999999999;');
    expect(decodeHtmlEntities('Invalido &#xD800;')).toBe('Invalido &#xD800;');
  });
});
