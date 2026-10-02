import React, { useState } from 'react';
import type { FormDefinition } from '@flacso/contracts';
import { OrientationMentionFields } from './OrientationMentionFields.js';

interface DynamicFormProps {
  form: FormDefinition;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  isSubmitting?: boolean;
  serverErrors?: Record<string, string[]>;
}

export const DynamicForm: React.FC<DynamicFormProps> = ({
  form,
  onSubmit,
  isSubmitting = false,
  serverErrors = {},
}) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const hasOrientationInput = form.inputs.some((i) => i.key === 'orientacion');
  const hasMentionInput = form.inputs.some((i) => i.key === 'mencion');
  const orientacionInput = form.inputs.find((i) => i.key === 'orientacion');
  const mencionInput = form.inputs.find((i) => i.key === 'mencion');

  const handleInputChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (clientErrors[key]) {
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.registrationOpen) {
      return;
    }

    // Client-side required validation
    const errors: Record<string, string> = {};
    for (const input of form.inputs) {
      const val = (values[input.key] || '').trim();
      if (input.required && val.length === 0) {
        errors[input.key] = `El campo ${input.label} es obligatorio.`;
      }
    }

    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      return;
    }

    setClientErrors({});
    await onSubmit(values);
  };

  // Filter out orientacion and mencion from standard input loop if handled by composite
  const regularInputs = form.inputs.filter(
    (i) => i.key !== 'orientacion' && i.key !== 'mencion'
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg shadow">
      {!form.registrationOpen && (
        <div className="p-4 mb-4 text-sm text-amber-800 rounded-lg bg-amber-50 border border-amber-200" role="alert">
          <strong>Preinscripción cerrada:</strong> Este destino académico no se encuentra aceptando preinscripciones actualmente.
        </div>
      )}

      {serverErrors._form && (
        <div className="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 border border-red-200" role="alert">
          {serverErrors._form.join(', ')}
        </div>
      )}

      {regularInputs.map((input) => {
        const value = values[input.key] || '';
        const error = clientErrors[input.key] || serverErrors[input.key]?.join(', ');

        return (
          <div key={input.key} className="field-group">
            <label htmlFor={`input-${input.key}`} className="block text-sm font-medium text-gray-700">
              {input.label} {input.required && <span className="text-red-600">*</span>}
            </label>
            <input
              id={`input-${input.key}`}
              name={input.key}
              type={input.type === 'tel' ? 'tel' : input.type === 'email' ? 'email' : input.type === 'date' ? 'date' : 'text'}
              value={value}
              onChange={(e) => handleInputChange(input.key, e.target.value)}
              disabled={!form.registrationOpen || isSubmitting}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
            {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
          </div>
        );
      })}

      {(hasOrientationInput || hasMentionInput) && form.orientations.length > 0 && (
        <OrientationMentionFields
          orientations={form.orientations}
          selectedOrientation={values.orientacion || ''}
          selectedMention={values.mencion || ''}
          onOrientationChange={(val) => handleInputChange('orientacion', val)}
          onMentionChange={(val) => handleInputChange('mencion', val)}
          orientationRequired={orientacionInput?.required ?? true}
          mentionRequired={mencionInput?.required ?? false}
          orientationError={clientErrors.orientacion || serverErrors.orientacion?.join(', ')}
          mentionError={clientErrors.mencion || serverErrors.mencion?.join(', ')}
          disabled={!form.registrationOpen || isSubmitting}
        />
      )}

      <div className="pt-4">
        <button
          type="submit"
          disabled={!form.registrationOpen || isSubmitting}
          className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Enviando preinscripción...' : form.registrationOpen ? 'Enviar preinscripción' : 'Inscripción cerrada'}
        </button>
      </div>
    </form>
  );
};
