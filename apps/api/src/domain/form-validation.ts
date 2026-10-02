import type { FormDefinition, ValidationResult } from '@flacso/contracts';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSubmission(
  form: FormDefinition,
  values: Record<string, string>,
  submittedRevision?: string
): ValidationResult {
  const fieldErrors: Record<string, string[]> = {};

  const addError = (field: string, error: string) => {
    if (!fieldErrors[field]) {
      fieldErrors[field] = [];
    }
    fieldErrors[field].push(error);
  };

  // 1. Revision check: must match form.configRevision
  if (submittedRevision !== undefined && submittedRevision !== form.configRevision) {
    addError('_form', 'El formulario ha sido actualizado. Por favor recargue la página.');
  }

  // 2. Validate input fields
  for (const input of form.inputs) {
    const rawVal = values[input.key];
    const val = rawVal !== undefined ? rawVal.trim() : '';

    if (input.required && val.length === 0) {
      addError(input.key, `El campo ${input.label} es obligatorio.`);
      continue;
    }

    if (val.length > 0) {
      if (input.type === 'email' && !EMAIL_REGEX.test(val)) {
        addError(input.key, 'El correo electrónico no tiene un formato válido.');
      }
    }
  }

  // 3. Validate orientation and mention consistency
  const orientacionVal = values.orientacion?.trim();
  const mencionVal = values.mencion?.trim();

  if (orientacionVal) {
    const selectedOrientation = form.orientations.find((o) => o.id === orientacionVal);
    if (!selectedOrientation) {
      addError('orientacion', 'La orientación seleccionada no es válida.');
    } else if (mencionVal) {
      const validMention = selectedOrientation.mentions.some((m) => m.id === mencionVal);
      if (!validMention) {
        addError(
          'mencion',
          'La mención seleccionada no corresponde a la orientación elegida.'
        );
      }
    }
  } else if (mencionVal) {
    addError('orientacion', 'Debe seleccionar una orientación antes de elegir una mención.');
  }

  const valid = Object.keys(fieldErrors).length === 0;

  return {
    valid,
    fieldErrors,
  };
}
