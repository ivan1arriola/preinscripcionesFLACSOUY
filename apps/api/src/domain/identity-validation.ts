import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

const URUGUAYAN_CEDULA_WEIGHTS = [2, 9, 8, 7, 6, 3, 4] as const;

export function formatUruguayanCedula(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return digits;
  return `${digits[0]}.${digits.slice(1, 4)}.${digits.slice(4, 7)}-${digits[7]}`;
}

export function isValidUruguayanCedula(value: string): boolean {
  const rawDigits = value.replace(/\D/g, '');
  if (rawDigits.length !== 7 && rawDigits.length !== 8) return false;

  const digits = rawDigits.padStart(8, '0');
  const sum = URUGUAYAN_CEDULA_WEIGHTS.reduce(
    (total, weight, index) => total + Number(digits[index]) * weight,
    0
  );
  const verifier = (10 - (sum % 10)) % 10;
  return verifier === Number(digits[7]);
}

export function normalizePhoneToE164(value: string, defaultCountry: CountryCode = 'UY'): string | null {
  const phone = parsePhoneNumberFromString(value.trim(), defaultCountry);
  return phone?.isValid() ? phone.number : null;
}

export function normalizeIdentityValues(values: Record<string, string>): Record<string, string> {
  const normalized = { ...values };

  if (values.tipoDocumento?.trim() === 'cedula_uruguaya' && isValidUruguayanCedula(values.documento ?? '')) {
    normalized.documento = formatUruguayanCedula(values.documento ?? '');
    normalized.paisEmisorDocumento = 'Uruguay';
  }

  const phone = normalizePhoneToE164(values.celular ?? '');
  if (phone) normalized.celular = phone;

  return normalized;
}
