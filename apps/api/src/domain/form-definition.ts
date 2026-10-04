import type { DocumentDefinition, InputDefinition } from '@flacso/contracts';

export const UNIVERSAL_INPUTS: InputDefinition[] = [
  ['nombre1', 'Primer nombre', 'text', true, 'Primer nombre'],
  ['nombre2', 'Segundo nombre', 'text', false, 'Segundo nombre'],
  ['apellido1', 'Primer apellido', 'text', true, 'Primer apellido'],
  ['apellido2', 'Segundo apellido', 'text', false, 'Segundo apellido'],
  ['email', 'Correo electrónico', 'email', true, 'Correo electrónico'],
  ['fechaNacimiento', 'Fecha de nacimiento', 'date', true, 'Fecha de nacimiento'],
  ['tipoDocumento', 'Tipo de documento', 'select', true, 'Tipo de documento'],
  ['documento', 'Número de documento', 'text', true, 'Número de documento'],
  ['paisEmisorDocumento', 'País emisor del documento', 'text', true, 'País emisor del documento'],
  ['genero', 'Identidad de género', 'select', true, 'Identidad de género'],
  ['generoOtra', 'Especifique su identidad de género', 'text', false, 'Especificación de identidad de género'],
  ['etnia', 'Raza / etnia', 'text', true, 'Raza / etnia'],
  ['celular', 'Celular', 'tel', true, 'Celular'],
  ['ciudadResidencia', 'Ciudad de residencia', 'text', true, 'Ciudad de residencia'],
  ['domicilio', 'Domicilio (incluyendo país)', 'text', false, 'Domicilio'],
  ['ocupacion', 'Ocupación actual', 'text', true, 'Ocupación actual'],
  ['paisNacimiento', 'País de nacimiento', 'text', true, 'País de nacimiento'],
  ['paisResidencia', 'País de residencia', 'text', true, 'País de residencia'],
  ['tieneConvenio', '¿Te corresponde algún convenio?', 'select', true, '¿Te corresponde algún convenio?'],
  ['convenioWordpressId', '¿Cuál convenio te corresponde?', 'text', false, 'Convenio'],
  ['fuente', '¿Cómo conociste esta propuesta?', 'select', true, 'Cómo conociste la propuesta'],
  ['aceptaDifusion', '¿Autorizás la difusión de imagen por parte de FLACSO Uruguay?', 'select', true, 'Autoriza difusión'],
  ['estudios', 'Estudios cursados', 'textarea', true, 'Estudios cursados'],
  ['posgradoFlacso', '¿Cursaste algún posgrado en FLACSO?', 'select', true, '¿Cursó posgrado en FLACSO?'],
  ['posgradoCual', '¿Cuál posgrado?', 'text', false, 'Cuál posgrado'],
].map(([key, label, type, required, spreadsheetColumn], index) => ({
  key: key as string,
  label: label as string,
  type: type as InputDefinition['type'],
  required: required as boolean,
  position: index + 1,
  spreadsheetColumn: spreadsheetColumn as string,
}));

export const SUPPORTED_SPECIFIC_INPUTS: Record<string, Omit<InputDefinition, 'position'>> = {
  titulo: {
    key: 'titulo', label: 'Título', type: 'text', required: true,
    spreadsheetColumn: 'Título',
  },
  escolaridad: {
    key: 'escolaridad', label: 'Escolaridad', type: 'text', required: true,
    spreadsheetColumn: 'Escolaridad',
  },
  orientacion: {
    key: 'orientacion', label: 'Orientación', type: 'select', required: true,
    spreadsheetColumn: 'Orientación', optionsSource: 'wordpress.orientaciones',
  },
  mencion: {
    key: 'mencion', label: 'Mención', type: 'select', required: false,
    spreadsheetColumn: 'Mención', optionsSource: 'wordpress.menciones',
  },
  institucion: {
    key: 'institucion', label: 'Institución', type: 'text', required: false,
    spreadsheetColumn: 'Institución',
  },
};

export const DOCUMENT_DEFINITIONS: Record<string, DocumentDefinition> = {
  identidad: {
    key: 'identidad', label: 'Documento de identidad', required: true,
    canDefer: false,
    maxFiles: 2, maxBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  },
  cv: {
    key: 'cv', label: 'Curriculum Vitae', required: true,
    canDefer: false,
    maxFiles: 1, maxBytes: 10 * 1024 * 1024, acceptedMimeTypes: ['application/pdf'],
  },
  titulo: {
    key: 'titulo', label: 'Título', required: true,
    canDefer: false,
    maxFiles: 1, maxBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  },
  cartaMotivacion: {
    key: 'cartaMotivacion', label: 'Carta de motivación', required: true,
    canDefer: false,
    maxFiles: 1, maxBytes: 10 * 1024 * 1024, acceptedMimeTypes: ['application/pdf'],
  },
  cartaRecomendacion1: {
    key: 'cartaRecomendacion1', label: 'Primera carta de recomendación', required: true,
    canDefer: false,
    maxFiles: 1, maxBytes: 10 * 1024 * 1024, acceptedMimeTypes: ['application/pdf'],
  },
  cartaRecomendacion2: {
    key: 'cartaRecomendacion2', label: 'Segunda carta de recomendación', required: true,
    canDefer: false,
    maxFiles: 1, maxBytes: 10 * 1024 * 1024, acceptedMimeTypes: ['application/pdf'],
  },
};

export const ALL_SUPPORTED_INPUT_KEYS = new Set<string>([
  ...UNIVERSAL_INPUTS.map((input) => input.key),
  ...Object.keys(SUPPORTED_SPECIFIC_INPUTS),
]);
