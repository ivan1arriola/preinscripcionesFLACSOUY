import React from 'react';
import type { InputDefinition } from '@flacso/contracts';

interface UniversalFieldsProps {
  inputs: InputDefinition[];
  values: Record<string, string>;
  errors: Record<string, string | undefined>;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
}

const choices: Record<string, Array<[string, string]>> = {
  tipoDocumento: [['cedula_uruguaya', 'Cédula de identidad uruguaya'], ['pasaporte', 'Pasaporte'], ['documento_extranjero', 'Documento extranjero']],
  genero: [['Mujer', 'Mujer'], ['Varon', 'Varón'], ['Mujer trans', 'Mujer trans'], ['Varon trans', 'Varón trans'], ['No binarie / no conforme', 'No binarie / no conforme'], ['Otra', 'Otra'], ['Prefiero no responder', 'Prefiero no responder']],
  tieneConvenio: [['No', 'No'], ['Si', 'Sí']],
  aceptaDifusion: [['No', 'No'], ['Si', 'Sí']],
  posgradoFlacso: [['No', 'No'], ['Si', 'Sí']],
  fuente: [['Facebook', 'Facebook'], ['Twitter', 'Twitter'], ['Instagram', 'Instagram'], ['Linkedin', 'LinkedIn'], ['Web', 'Web'], ['Recomendacion', 'Recomendación'], ['Mailing', 'Mailing'], ['Otro', 'Otro']],
};

export const UniversalFields: React.FC<UniversalFieldsProps> = ({ inputs, values, errors, disabled, onChange }) => {
  const visible = (input: InputDefinition) => {
    if (input.key === 'generoOtra') return values.genero === 'Otra';
    if (input.key === 'convenioWordpressId') return values.tieneConvenio === 'Si';
    if (input.key === 'posgradoCual') return values.posgradoFlacso === 'Si';
    return true;
  };

  return <div className="space-y-4">
    {inputs.filter(visible).map((input) => {
      const value = values[input.key] || '';
      const error = errors[input.key];
      const options = choices[input.key];
      return <div key={input.key} className="field-group">
        <label htmlFor={`input-${input.key}`} className="block text-sm font-medium text-gray-700">
          {input.label} {input.required && <span className="text-red-600">*</span>}
        </label>
        {options ? <select id={`input-${input.key}`} name={input.key} value={value} onChange={(e) => onChange(input.key, e.target.value)} disabled={disabled}>
          <option value="">-- Seleccione una opción --</option>
          {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
        </select> : input.type === 'textarea' ? <textarea id={`input-${input.key}`} name={input.key} value={value} onChange={(e) => onChange(input.key, e.target.value)} disabled={disabled} rows={3} /> : <input id={`input-${input.key}`} name={input.key} type={input.type === 'date' ? 'date' : input.type === 'email' ? 'email' : input.type === 'tel' ? 'tel' : 'text'} value={value} onChange={(e) => onChange(input.key, e.target.value)} disabled={disabled} />}
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>;
    })}
  </div>;
};
