import React, { useEffect, useState } from 'react';
import * as Flags from 'country-flag-icons/react/3x2';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import type { AgreementOption, InputDefinition } from '@flacso/contracts';
import { CountrySelect } from './CountrySelect.js';
import { COUNTRY_KEYS } from '../domain/countries.js';

interface UniversalFieldsProps {
  inputs: InputDefinition[];
  values: Record<string, string>;
  errors: Record<string, string | undefined>;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
  /** Se llama al salir de un campo, para validarlo en el momento. */
  onBlurField?: (key: string) => void;
  agreements?: AgreementOption[];
}

const choices: Record<string, Array<[string, string]>> = {
  tipoDocumento: [['cedula_uruguaya', 'Cédula de identidad uruguaya'], ['pasaporte', 'Pasaporte'], ['documento_extranjero', 'Documento extranjero']],
  genero: [['Mujer', 'Mujer'], ['Varon', 'Varón'], ['Mujer trans', 'Mujer trans'], ['Varon trans', 'Varón trans'], ['No binarie', 'No binarie'], ['Otra', 'Otra'], ['Prefiero no responder', 'Prefiero no responder']],
  tieneConvenio: [['No', 'No'], ['Si', 'Sí']],
  aceptaDifusion: [['No', 'No'], ['Si', 'Sí']],
  aceptaComunicaciones: [['No', 'No'], ['Si', 'Sí']],
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
const yesNoKeys = new Set(['tieneConvenio', 'aceptaDifusion', 'aceptaComunicaciones', 'posgradoFlacso']);
// Campos que ocupan todo el ancho de la grilla; el resto se acomoda de a dos (nombres con apellidos, por ejemplo).
const wideKeys = new Set(['celular', 'domicilio', 'estudios', 'generoOtra', 'posgradoCual', 'convenioWordpressId', 'fuente', 'tituloDenominacion', ...yesNoKeys]);

// Atributos autocomplete para que el navegador (y sobre todo el celular) complete los datos conocidos.
const autocompleteByKey: Record<string, string> = {
  nombre1: 'given-name',
  nombre2: 'additional-name',
  apellido1: 'family-name',
  fechaNacimiento: 'bday',
  email: 'email',
  emailConfirmacion: 'email',
  celular: 'tel-national',
  ciudadResidencia: 'address-level2',
  domicilio: 'street-address',
  paisResidencia: 'country-name',
  ocupacion: 'organization-title',
  documento: 'off',
};

const documentHint = (type: string | undefined) => {
  if (type === 'pasaporte') return 'Número tal como figura en el pasaporte.';
  if (type === 'documento_extranjero') return 'Número tal como figura en el documento.';
  if (!type) return 'Elegí primero el tipo de documento.';
  return '';
};

export const UniversalFields: React.FC<UniversalFieldsProps> = ({ inputs, values, errors, disabled, onChange, onBlurField, agreements = [] }) => {
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(() =>
    parsePhoneNumberFromString(values.celular ?? '')?.country ?? 'UY'
  );
  const [phoneStatus, setPhoneStatus] = useState('');
  // El asistente desmonta pasos: recuperar el país desde el valor internacional persistido.
  useEffect(() => {
    const storedCountry = parsePhoneNumberFromString(values.celular ?? '')?.country;
    if (storedCountry && storedCountry !== phoneCountry) setPhoneCountry(storedCountry);
  }, [values.celular]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cedulaStatus, setCedulaStatus] = useState('');
  const FlagComponent = Flags[phoneCountry as keyof typeof Flags] as React.ComponentType<{ className?: string; title?: string }> | undefined;
  const isUruguayanCedula = values.tipoDocumento === 'cedula_uruguaya';
  const visible = (input: InputDefinition) => {
    if (input.key === 'generoOtra') return values.genero === 'Otra';
    if (input.key === 'convenioWordpressId') return values.tieneConvenio === 'Si';
    if (input.key === 'posgradoCual') return values.posgradoFlacso === 'Si';
    return true;
  };

  // Con cédula uruguaya el país emisor es Uruguay: el campo queda en su lugar, fijo, para que el formulario no se mueva.
  const hasIssuerInput = inputs.some((input) => input.key === 'paisEmisorDocumento');
  useEffect(() => {
    if (hasIssuerInput && isUruguayanCedula && values.paisEmisorDocumento !== 'Uruguay') onChange('paisEmisorDocumento', 'Uruguay');
  }, [hasIssuerInput, isUruguayanCedula, values.paisEmisorDocumento]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (key: string, value: string) => {
    onChange(key, value);
    if (key === 'tipoDocumento') {
      if (value === 'cedula_uruguaya') onChange('paisEmisorDocumento', 'Uruguay');
      else if (isUruguayanCedula && values.paisEmisorDocumento === 'Uruguay') onChange('paisEmisorDocumento', '');
    }
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

  return <div className="fields-grid">{inputs.filter(visible).map((input) => {
    const issuerLocked = input.key === 'paisEmisorDocumento' && isUruguayanCedula;
    const value = issuerLocked ? 'Uruguay' : values[input.key] || ''; const error = errors[input.key]; const options = choices[input.key];
    const label = input.key === 'documento' && isUruguayanCedula ? 'Cédula de identidad uruguaya' : input.label;
    const phoneInputValue = input.key === 'celular' && value.startsWith('+')
      ? parsePhoneNumberFromString(value)?.formatNational() ?? value
      : value;
    const errorId = `error-${input.key}`;
    const describedBy = (...ids: Array<string | false | undefined>) => ids.filter(Boolean).join(' ') || undefined;
    const invalid = error ? true : undefined;
    const isWide = wideKeys.has(input.key) || input.type === 'textarea';
    const blur = () => onBlurField?.(input.key);
    const autoComplete = autocompleteByKey[input.key];
    const isCountry = COUNTRY_KEYS.has(input.key);
    const cedulaOk = isValidCedula(value);
    return <div key={input.key} className={`field-group${isWide ? ' field-group--wide' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={`input-${input.key}`} className="field-label">{label} {input.required && <span className="field-required">*</span>}</label>
      {input.key === 'celular' ? <>
        <label htmlFor="phone-country" className="sr-only">País del teléfono</label>
        <div className="phone-input">
          <div className="phone-country-control">
            <div className="phone-country-trigger" aria-hidden="true">
              {FlagComponent && <FlagComponent className="phone-flag" title={regionNames?.of(phoneCountry) ?? phoneCountry} />}
              <span className="phone-calling-code">+{getCountryCallingCode(phoneCountry)}</span>
              <span className="phone-chevron">▾</span>
            </div>
            <select
              id="phone-country"
              className="phone-country-select"
              value={phoneCountry}
              disabled={disabled}
              onChange={(event) => {
                const country = event.target.value as CountryCode;
                setPhoneCountry(country);
                setPhoneStatus('');
                // Un número anterior no debe seguir guardado bajo un prefijo distinto.
                if (values.celular) onChange('celular', '');
              }}
            >
              {getCountries().map((country) => (
                <option key={country} value={country}>
                  {regionNames?.of(country) ?? country} +{getCountryCallingCode(country)}
                </option>
              ))}
            </select>
          </div>
          <input
            id={`input-${input.key}`}
            name={input.key}
            type="tel"
            value={phoneInputValue}
            onChange={(event) => updatePhone(event.target.value)}
            onBlur={blur}
            disabled={disabled}
            placeholder={phonePlaceholderFor(phoneCountry)}
            autoComplete={autoComplete}
            aria-invalid={invalid}
            aria-describedby={describedBy('celular-ayuda', phoneStatus && 'celular-estado', error && errorId)}
          />
        </div>
        <p id="celular-ayuda" className="field-hint">Elegí el país e ingresá el número. Se guardará con el código internacional.</p>
        {phoneStatus && <p id="celular-estado" className="field-status" aria-live="polite">{phoneStatus}</p>}
      </> : yesNoKeys.has(input.key) ? <fieldset className="choice-group" aria-describedby={error ? errorId : undefined}>
        <legend className="sr-only">{label}</legend>
        {(choices[input.key] ?? []).map(([optionValue, optionLabel]) => <label className="choice-card" key={optionValue}>
          <input type="radio" name={input.key} value={optionValue} checked={value === optionValue} onChange={(event) => handleChange(input.key, event.target.value)} onBlur={blur} disabled={disabled} />
          <span>{optionLabel}</span>
        </label>)}
      </fieldset>
      : isCountry ? <CountrySelect
          id={`input-${input.key}`}
          name={input.key}
          value={value}
          onChange={(name) => handleChange(input.key, name)}
          onBlur={blur}
          disabled={disabled || issuerLocked}
          invalid={Boolean(error)}
          describedBy={describedBy(input.key === 'paisEmisorDocumento' && 'pais-emisor-ayuda', error && errorId)}
          autoComplete={autoComplete}
        />
      : input.key === 'convenioWordpressId' ? <select id={`input-${input.key}`} name={input.key} value={value} onChange={(event) => handleChange(input.key, event.target.value)} onBlur={blur} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy(error && errorId)}><option value="">Seleccioná un convenio</option>{agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.label}</option>)}</select>
      : options ? <select id={`input-${input.key}`} name={input.key} value={value} onChange={(event) => handleChange(input.key, event.target.value)} onBlur={blur} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy(error && errorId)}><option value="">Seleccioná una opción</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>
      : input.key === 'documento' && isUruguayanCedula ? <>
        <input id={`input-${input.key}`} name={input.key} type="text" inputMode="numeric" autoComplete="off" value={value} onChange={(event) => { const formatted = formatCedula(event.target.value); handleChange(input.key, formatted); setCedulaStatus(formatted.length ? (isValidCedula(formatted) ? 'Cédula válida.' : 'Cédula o dígito verificador no válidos.') : 'Ingresá los 8 dígitos de la cédula.'); }} onBlur={blur} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy('documento-ayuda', error && errorId)} />
      </> : input.type === 'textarea' ? <textarea id={`input-${input.key}`} name={input.key} value={value} onChange={(event) => handleChange(input.key, event.target.value)} onBlur={blur} disabled={disabled} rows={3} aria-invalid={invalid} aria-describedby={describedBy(error && errorId)} />
      : <input id={`input-${input.key}`} name={input.key} type={input.type === 'date' ? 'date' : input.type === 'email' ? 'email' : input.type === 'tel' ? 'tel' : 'text'} autoComplete={autoComplete} value={value} onChange={(event) => handleChange(input.key, event.target.value)} onBlur={blur} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy(input.key === 'documento' && 'documento-ayuda', error && errorId)} />}
      {input.key === 'documento' && (
        <p id="documento-ayuda" className={`field-hint field-hint--slot${isUruguayanCedula && value && cedulaOk ? ' field-hint--ok' : ''}${isUruguayanCedula && value && !cedulaOk ? ' field-hint--bad' : ''}`} aria-live="polite">
          {isUruguayanCedula ? (cedulaStatus || 'Se valida con el dígito verificador.') : documentHint(values.tipoDocumento)}
        </p>
      )}
      {input.key === 'paisEmisorDocumento' && <p id="pais-emisor-ayuda" className="field-hint field-hint--slot">{issuerLocked ? 'El país emisor es Uruguay.' : 'País que emitió el documento.'}</p>}
      {input.key === 'convenioWordpressId' && agreements.length === 0 && <p className="field-hint">No hay convenios disponibles en este momento.</p>}
      {error && <p id={errorId} className="field-error">{error}</p>}
    </div>;
  })}</div>;
};
