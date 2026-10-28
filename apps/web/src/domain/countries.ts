import { getCountries, type CountryCode } from 'libphonenumber-js';

export interface CountryOption {
  code: CountryCode;
  /** Nombre en español: es el valor que se guarda en la preinscripción. */
  name: string;
}

// Primero Uruguay y la región, que son las nacionalidades más frecuentes entre quienes se preinscriben.
const PRIORITY_CODES: CountryCode[] = ['UY', 'AR', 'BR', 'CL', 'PY', 'BO', 'PE', 'CO', 'VE', 'EC', 'MX', 'ES', 'US'];

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['es'], { type: 'region' }) : undefined;

/** Sin tildes ni mayúsculas, para comparar lo que escribe la persona con los nombres de la lista. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function buildCountries(): CountryOption[] {
  const all = getCountries()
    .map((code) => ({ code, name: regionNames?.of(code) ?? code }))
    .filter((country) => country.name !== country.code);
  const priority = PRIORITY_CODES.map((code) => all.find((country) => country.code === code)).filter(
    (country): country is CountryOption => Boolean(country)
  );
  const rest = all
    .filter((country) => !PRIORITY_CODES.includes(country.code))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return [...priority, ...rest];
}

export const COUNTRIES: CountryOption[] = buildCountries();

export function findCountryByName(name: string): CountryOption | undefined {
  const wanted = normalizeSearch(name);
  return wanted ? COUNTRIES.find((country) => normalizeSearch(country.name) === wanted) : undefined;
}

export function searchCountries(query: string): CountryOption[] {
  const wanted = normalizeSearch(query);
  if (!wanted) return COUNTRIES;
  const starts = COUNTRIES.filter((country) => normalizeSearch(country.name).startsWith(wanted));
  const contains = COUNTRIES.filter(
    (country) => !starts.includes(country) && normalizeSearch(country.name).includes(wanted)
  );
  return [...starts, ...contains];
}

export const COUNTRY_KEYS = new Set(['paisEmisorDocumento', 'paisNacimiento', 'paisResidencia']);
