import type { InputDefinition } from '@flacso/contracts';

export const UNIVERSAL_INPUTS: InputDefinition[] = [
  {
    key: 'nombre',
    label: 'Nombre',
    type: 'text',
    required: true,
    position: 1,
    spreadsheetColumn: 'Nombre',
  },
  {
    key: 'apellido',
    label: 'Apellido',
    type: 'text',
    required: true,
    position: 2,
    spreadsheetColumn: 'Apellido',
  },
  {
    key: 'email',
    label: 'Correo electrónico',
    type: 'email',
    required: true,
    position: 3,
    spreadsheetColumn: 'Correo electrónico',
  },
  {
    key: 'telefono',
    label: 'Teléfono',
    type: 'tel',
    required: false,
    position: 4,
    spreadsheetColumn: 'Teléfono',
  },
];

export const SUPPORTED_SPECIFIC_INPUTS: Record<string, Omit<InputDefinition, 'position'>> = {
  documento: {
    key: 'documento',
    label: 'Documento',
    type: 'text',
    required: true,
    spreadsheetColumn: 'Documento',
  },
  fechaNacimiento: {
    key: 'fechaNacimiento',
    label: 'Fecha de nacimiento',
    type: 'date',
    required: true,
    spreadsheetColumn: 'Fecha de nacimiento',
  },
  titulo: {
    key: 'titulo',
    label: 'Título',
    type: 'text',
    required: true,
    spreadsheetColumn: 'Título',
  },
  escolaridad: {
    key: 'escolaridad',
    label: 'Escolaridad',
    type: 'text',
    required: true,
    spreadsheetColumn: 'Escolaridad',
  },
  orientacion: {
    key: 'orientacion',
    label: 'Orientación',
    type: 'select',
    required: true,
    spreadsheetColumn: 'Orientación',
    optionsSource: 'wordpress.orientaciones',
  },
  mencion: {
    key: 'mencion',
    label: 'Mención',
    type: 'select',
    required: false,
    spreadsheetColumn: 'Mención',
    optionsSource: 'wordpress.menciones',
  },
  institucion: {
    key: 'institucion',
    label: 'Institución',
    type: 'text',
    required: false,
    spreadsheetColumn: 'Institución',
  },
  ocupacion: {
    key: 'ocupacion',
    label: 'Ocupación',
    type: 'text',
    required: false,
    spreadsheetColumn: 'Ocupación',
  },
};

export const ALL_SUPPORTED_INPUT_KEYS = new Set<string>([
  ...UNIVERSAL_INPUTS.map((u) => u.key),
  ...Object.keys(SUPPORTED_SPECIFIC_INPUTS),
]);
