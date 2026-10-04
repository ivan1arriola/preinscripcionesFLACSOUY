import type { FormDefinition, SubmissionFileToken, ValidationResult } from '@flacso/contracts';
import { isValidUruguayanCedula, normalizePhoneToE164 } from './identity-validation.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOCUMENT_TYPES = new Set(['cedula_uruguaya', 'pasaporte', 'documento_extranjero']);
const GENDER_VALUES = new Set([
  'Mujer', 'Varon', 'Mujer trans', 'Varon trans',
  'No binarie / no conforme', 'Otra', 'Prefiero no responder',
]);
const YES_NO_VALUES = new Set(['Si', 'No']);

export function validateSubmission(
  form: FormDefinition,
  values: Record<string, string>,
  submittedRevision?: string,
  files?: SubmissionFileToken[] | string[]
): ValidationResult {
  const fieldErrors: Record<string, string[]> = {};

  const addError = (field: string, error: string) => {
    if (!fieldErrors[field]) {
      fieldErrors[field] = [];
    }
    fieldErrors[field].push(error);
  };

  // 1. Revision check: must match form.effectiveRevision or form.configRevision
  const expectedRevisions = new Set([form.effectiveRevision, form.configRevision].filter(Boolean));
  if (submittedRevision !== undefined && !expectedRevisions.has(submittedRevision)) {
    addError('_form', 'El formulario ha sido actualizado. Por favor recargue la página.');
  }

  // 2. Validate input fields
  for (const input of form.inputs) {
    if (input.key === 'tituloDenominacion' || input.key === 'sinTituloActual') {
      continue;
    }
    if (input.key === 'paisEmisorDocumento' && values.tipoDocumento?.trim() === 'cedula_uruguaya') {
      continue;
    }

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

  // 3. Validate orientation and mention independently
  const orientacionVal = values.orientacion?.trim();
  const mencionVal = values.mencion?.trim();

  if (orientacionVal) {
    const matches = form.orientations.some((orientation: any) =>
      typeof orientation === 'string'
        ? orientation === orientacionVal
        : orientation.id === orientacionVal || orientation.name === orientacionVal
    );
    if (!matches) {
      addError('orientacion', 'La orientación seleccionada no es válida.');
    }
  }

  if (mencionVal) {
    const matches = (form.mentions ?? []).some((mention: any) =>
      typeof mention === 'string'
        ? mention === mencionVal
        : mention.id === mencionVal || mention.name === mencionVal
    );
    if (!matches) {
      addError('mencion', 'La mención seleccionada no es válida.');
    }
  }

  const tipoDocumento = values.tipoDocumento?.trim();
  if (tipoDocumento && !DOCUMENT_TYPES.has(tipoDocumento)) {
    addError('tipoDocumento', 'El tipo de documento seleccionado no es válido.');
  }

  const paisEmisor = values.paisEmisorDocumento?.trim();
  if (tipoDocumento && tipoDocumento !== 'cedula_uruguaya' && !paisEmisor) {
    addError('paisEmisorDocumento', 'Indicá el país que emitió el documento.');
  }

  const documento = values.documento?.trim() ?? '';
  if (tipoDocumento === 'cedula_uruguaya' && documento && !isValidUruguayanCedula(documento)) {
    addError('documento', 'La cédula o su dígito verificador no son válidos.');
  }
  if (tipoDocumento && tipoDocumento !== 'cedula_uruguaya' && documento && !/^[\p{L}\p{N} ./-]{3,40}$/u.test(documento)) {
    addError('documento', 'Usá entre 3 y 40 caracteres válidos para el documento.');
  }

  const celular = values.celular?.trim() ?? '';
  if (celular && !normalizePhoneToE164(celular)) {
    addError('celular', 'Ingresá un número de teléfono válido con su código de país.');
  }

  const genero = values.genero?.trim();
  if (genero && !GENDER_VALUES.has(genero)) {
    addError('genero', 'La identidad de género seleccionada no es válida.');
  }
  if (genero === 'Otra' && !values.generoOtra?.trim()) {
    addError('generoOtra', 'Especificá tu identidad de género.');
  }

  const tieneConvenio = values.tieneConvenio?.trim();
  const convenioWordpressId = values.convenioWordpressId?.trim() ?? '';
  if (tieneConvenio && !YES_NO_VALUES.has(tieneConvenio)) {
    addError('tieneConvenio', 'La respuesta sobre convenio no es válida.');
  }
  if (tieneConvenio === 'Si' && !convenioWordpressId) {
    addError('convenioWordpressId', 'Seleccioná el convenio que te corresponde.');
  }
  if (tieneConvenio === 'Si' && convenioWordpressId && !form.agreements?.some((agreement) => agreement.id === convenioWordpressId)) {
    addError('convenioWordpressId', 'El convenio seleccionado ya no está disponible.');
  }

  const aceptaDifusion = values.aceptaDifusion?.trim();
  if (aceptaDifusion && !YES_NO_VALUES.has(aceptaDifusion)) {
    addError('aceptaDifusion', 'La respuesta sobre difusión no es válida.');
  }

  const posgradoFlacso = values.posgradoFlacso?.trim();
  if (posgradoFlacso && !YES_NO_VALUES.has(posgradoFlacso)) {
    addError('posgradoFlacso', 'La respuesta sobre posgrado no es válida.');
  }
  if (posgradoFlacso === 'Si' && !values.posgradoCual?.trim()) {
    addError('posgradoCual', 'Indicá cuál posgrado cursaste en FLACSO.');
  }

  const sinTituloActual = values.sinTituloActual?.trim();
  if (sinTituloActual && !YES_NO_VALUES.has(sinTituloActual)) {
    addError('sinTituloActual', 'La respuesta sobre posesión de título no es válida.');
  }

  const providedFileKeys = files !== undefined
    ? new Set(
        files.map((file) => (typeof file === 'string' ? file : file.fieldKey))
      )
    : undefined;

  const hasTituloDoc = (form.documents ?? []).some((d) => d.key === 'titulo');
  if (hasTituloDoc) {
    const isSinTitulo = sinTituloActual === 'Si';
    const tituloDenominacion = values.tituloDenominacion?.trim() ?? '';

    if (isSinTitulo) {
      if (tituloDenominacion.length > 0) {
        addError('tituloDenominacion', 'No debes ingresar denominación si declaraste no poseer título.');
      }
      if (providedFileKeys && providedFileKeys.has('titulo')) {
        addError('titulo', 'No debes adjuntar el título si declaraste no poseer título.');
      }
    } else {
      if (tituloDenominacion.length === 0) {
        addError('tituloDenominacion', 'El campo Denominación del título es obligatorio.');
      }
      if (providedFileKeys && !providedFileKeys.has('titulo')) {
        addError('titulo', 'El documento Título de grado o terciario es obligatorio.');
      }
    }
  }

  for (const doc of form.documents ?? []) {
    if (doc.key === 'titulo') continue;

    if (doc.key === 'cartaRecomendacion1' || doc.key === 'cartaRecomendacion2') {
      if (providedFileKeys && !providedFileKeys.has(doc.key)) {
        addError(doc.key, `El documento ${doc.label} es obligatorio.`);
      }
      continue;
    }

    if (providedFileKeys && doc.required && !doc.canDefer && !providedFileKeys.has(doc.key)) {
      addError(doc.key, `El documento ${doc.label} es obligatorio.`);
    }
  }

  const valid = Object.keys(fieldErrors).length === 0;

  return {
    valid,
    fieldErrors,
  };
}
