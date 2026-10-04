import React, { useState } from 'react';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import type { AgreementOption, InputDefinition } from '@flacso/contracts';

interface UniversalFieldsProps {
  inputs: InputDefinition[];
  values: Record<string, string>;
  errors: Record<string, string | undefined>;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
  agreements?: AgreementOption[];
}

const choices: Record<string, Array<[string, string]>> = {
  tipoDocumento: [['cedula_uruguaya', 'Cédula de identidad uruguaya'], ['pasaporte', 'Pasaporte'], ['documento_extranjero', 'Documento extranjero']],
  genero: [['Mujer', 'Mujer'], ['Varon', 'Varón'], ['Mujer trans', 'Mujer trans'], ['Varon trans', 'Varón trans'], ['No binarie / no conforme', 'No binarie / no conforme'], ['Otra', 'Otra'], ['Prefiero no responder', 'Prefiero no responder']],
  tieneConvenio: [['No', 'No'], ['Si', 'Sí']],
  aceptaDifusion: [['No', 'No'], ['Si', 'Sí']],
  posgradoFlacso: [['No', 'No'], ['Si', 'Sí']],
  fuente: [['Facebook', 'Facebook'], ['Twitter', 'Twitter'], ['Instagram', 'Instagram'], ['Linkedin', 'LinkedIn'], ['Web', 'Web'], ['Recomendacion', 'Recomendación'], ['Mailing', 'Mailing'], ['Otro', 'Otro']],
};

const formatCedula = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length === 8 ? `${digits[0]}.${digits.slice(1, 4)}.${digits.slice(4, 7)}-${digits[7]}` : digits;
};
const isValidCedula = (value: string) => {
  const raw = value.replace(/\D/g, '');
  if (raw.length !== 7 && raw.length !== 8) return false;
  const digits = raw.padStart(8, '0');
  const weights = [2, 9, 8, 7, 6, 3, 4];
  return (10 - (weights.reduce((sum, weight, index) => sum + Number(digits[index]) * weight, 0) % 10)) % 10 === Number(digits[7]);
};
const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['es'], { type: 'region' }) : undefined;
const flagFor = (country: CountryCode) => String.fromCodePoint(...[...country].map((letter) => 0x1F1E6 + letter.charCodeAt(0) - 65));
const phonePlaceholders: Partial<Record<CountryCode, string>> = {
  UY: '99 123 456',
  AR: '11 1234 5678',
  BR: '(11) 91234-5678',
  CL: '9 1234 5678',
  PY: '981 123 456',
  US: '(201) 555-0123',
  ES: '612 345 678',
};
const phonePlaceholderFor = (country: CountryCode) => phonePlaceholders[country] ?? 'Número local';
const yesNoKeys = new Set(['tieneConvenio', 'aceptaDifusion', 'posgradoFlacso']);

export const UniversalFields: React.FC<UniversalFieldsProps> = ({ inputs, values, errors, disabled, onChange, agreements = [] }) => {
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('UY');
  const [phoneStatus, setPhoneStatus] = useState('');
  const [cedulaStatus, setCedulaStatus] = useState('');
  const isUruguayanCedula = values.tipoDocumento === 'cedula_uruguaya';
  const visible = (input: InputDefinition) => {
    if (input.key === 'generoOtra') return values.genero === 'Otra';
    if (input.key === 'convenioWordpressId') return values.tieneConvenio === 'Si';
    if (input.key === 'posgradoCual') return values.posgradoFlacso === 'Si';
    if (input.key === 'paisEmisorDocumento') return !isUruguayanCedula;
    return true;
  };

  const updatePhone = (raw: string) => {
    const phone = parsePhoneNumberFromString(raw, phoneCountry);
    if (!phone?.isValid()) {
      setPhoneStatus(raw.trim() ? 'El número no es válido para el país seleccionado.' : 'Seleccioná el país e ingresá el número.');
      onChange('celular', raw);
      return;
    }
    setPhoneStatus(`Se guardará como ${phone.number}.`);
    onChange('celular', phone.number);
  };

  return <div className="space-y-4">{inputs.filter(visible).map((input) => {
    const value = values[input.key] || ''; const error = errors[input.key]; const options = choices[input.key];
    const label = input.key === 'documento' && isUruguayanCedula ? 'Cédula de identidad uruguaya' : input.label;
    const phoneInputValue = input.key === 'celular' && value.startsWith('+')
      ? parsePhoneNumberFromString(value)?.formatNational() ?? value
      : value;
    return <div key={input.key} className="field-group">
      <label htmlFor={`input-${input.key}`} className="block text-sm font-medium text-gray-700">{label} {input.required && <span className="text-red-600">*</span>}</label>
      {input.key === 'celular' ? <>
        <label htmlFor="phone-country" className="sr-only">País del teléfono</label>
        <div className="phone-input">
          <select id="phone-country" value={phoneCountry} disabled={disabled} onChange={(event) => setPhoneCountry(event.target.value as CountryCode)}>{getCountries().map((country) => <option key={country} value={country}>{flagFor(country)} {regionNames?.of(country) ?? country} +{getCountryCallingCode(country)}</option>)}</select>
          <input id={`input-${input.key}`} name={input.key} type="tel" value={phoneInputValue} onChange={(event) => updatePhone(event.target.value)} disabled={disabled} placeholder={phonePlaceholderFor(phoneCountry)} aria-describedby="celular-ayuda celular-estado" />
        </div>
        <p id="celular-ayuda" className="mt-1 text-xs text-gray-500">Elegí el país e ingresá el número. Se guardará con el código internacional.</p>
        {phoneStatus && <p id="celular-estado" className="mt-1 text-xs text-gray-600" aria-live="polite">{phoneStatus}</p>}
      </> : yesNoKeys.has(input.key) ? <fieldset className="choice-group" aria-describedby={error ? `error-${input.key}` : undefined}>
        <legend className="sr-only">{label}</legend>
        {(choices[input.key] ?? []).map(([optionValue, optionLabel]) => <label className="choice-card" key={optionValue}>
          <input type="radio" name={input.key} value={optionValue} checked={value === optionValue} onChange={(event) => onChange(input.key, event.target.value)} disabled={disabled} />
          <span>{optionLabel}</span>
        </label>)}
      </fieldset>
      : input.key === 'convenioWordpressId' ? <select id={`input-${input.key}`} name={input.key} value={value} onChange={(event) => onChange(input.key, event.target.value)} disabled={disabled}><option value="">Seleccioná un convenio</option>{agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.label}</option>)}</select>
      : options ? <select id={`input-${input.key}`} name={input.key} value={value} onChange={(event) => onChange(input.key, event.target.value)} disabled={disabled}><option value="">-- Seleccione una opción --</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>
      : input.key === 'documento' && isUruguayanCedula ? <>
        <input id={`input-${input.key}`} name={input.key} type="text" value={value} onChange={(event) => { const formatted = formatCedula(event.target.value); onChange(input.key, formatted); setCedulaStatus(formatted.length ? (isValidCedula(formatted) ? 'Cédula válida.' : 'La cédula o su dígito verificador no son válidos.') : 'Ingresá los 8 dígitos de la cédula.'); }} disabled={disabled} aria-describedby="cedula-ayuda cedula-estado" />
        <p id="cedula-ayuda" className="mt-1 text-xs text-gray-500">Se valida automáticamente, incluido el dígito verificador.</p>
        {cedulaStatus && <p id="cedula-estado" className="mt-1 text-xs text-gray-600" aria-live="polite">{cedulaStatus}</p>}
      </> : input.type === 'textarea' ? <textarea id={`input-${input.key}`} name={input.key} value={value} onChange={(event) => onChange(input.key, event.target.value)} disabled={disabled} rows={3} />
      : <input id={`input-${input.key}`} name={input.key} type={input.type === 'date' ? 'date' : input.type === 'email' ? 'email' : input.type === 'tel' ? 'tel' : 'text'} value={value} onChange={(event) => onChange(input.key, event.target.value)} disabled={disabled} />}
      {input.key === 'convenioWordpressId' && agreements.length === 0 && <p className="mt-1 text-xs text-gray-500">No hay convenios disponibles en este momento.</p>}
      {error && <p id={`error-${input.key}`} className="mt-1 text-sm text-red-600">{error}</p>}
    </div>;
  })}</div>;
};
