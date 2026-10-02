import { describe, expect, it } from 'vitest';
import {
  formatUruguayanCedula,
  isValidUruguayanCedula,
  normalizeIdentityValues,
  normalizePhoneToE164,
} from './identity-validation.js';

describe('identity validation', () => {
  it('formats and validates a Uruguayan identity card with its verifier digit', () => {
    expect(formatUruguayanCedula('3.456.789-4')).toBe('3.456.789-4');
    expect(isValidUruguayanCedula('34567894')).toBe(true);
    expect(isValidUruguayanCedula('34567890')).toBe(false);
  });

  it('accepts seven-digit Uruguayan cards by padding the verifier calculation', () => {
    expect(isValidUruguayanCedula('1234561')).toBe(true);
    expect(isValidUruguayanCedula('1234567')).toBe(false);
  });

  it('normalizes local and international phone numbers to E.164', () => {
    expect(normalizePhoneToE164('099 123 456', 'UY')).toBe('+59899123456');
    expect(normalizePhoneToE164('+1 650 253 0000', 'UY')).toBe('+16502530000');
  });

  it('rejects a phone number that is not valid for the selected country', () => {
    expect(normalizePhoneToE164('123', 'UY')).toBeNull();
  });

  it('stores the Uruguayan card and phone in their canonical formats', () => {
    expect(normalizeIdentityValues({
      tipoDocumento: 'cedula_uruguaya',
      documento: '34567894',
      paisEmisorDocumento: 'Chile',
      celular: '099 123 456',
    })).toMatchObject({
      documento: '3.456.789-4',
      paisEmisorDocumento: 'Uruguay',
      celular: '+59899123456',
    });
  });
});
