import { describe, it, expect } from 'vitest';
import { validateSubmission } from './form-validation.js';
import type { FormDefinition } from '@flacso/contracts';

describe('validateSubmission', () => {
  const form: FormDefinition = {
    targetId: 'davia-c11',
    title: 'DAVIA Cohorte 11',
    kind: 'academic_offer',
    registrationOpen: true,
    configRevision: 'rev-xyz',
    inputs: [
      { key: 'nombre1', label: 'Primer nombre', type: 'text', required: true, position: 1 },
      { key: 'nombre2', label: 'Segundo nombre', type: 'text', required: false, position: 2 },
      { key: 'apellido1', label: 'Primer apellido', type: 'text', required: true, position: 3 },
      { key: 'apellido2', label: 'Segundo apellido', type: 'text', required: false, position: 4 },
      { key: 'email', label: 'Correo electrónico', type: 'email', required: true, position: 3 },
      { key: 'fechaNacimiento', label: 'Fecha de nacimiento', type: 'date', required: true, position: 5 },
      { key: 'tipoDocumento', label: 'Tipo de documento', type: 'select', required: true, position: 6 },
      { key: 'documento', label: 'Documento', type: 'text', required: true, position: 7 },
      { key: 'paisEmisorDocumento', label: 'País emisor', type: 'text', required: true, position: 8 },
      { key: 'genero', label: 'Identidad de género', type: 'select', required: true, position: 9 },
      { key: 'etnia', label: 'Raza / etnia', type: 'text', required: true, position: 10 },
      { key: 'celular', label: 'Celular', type: 'tel', required: true, position: 11 },
      { key: 'domicilio', label: 'Domicilio', type: 'text', required: true, position: 12 },
      { key: 'ocupacion', label: 'Ocupación actual', type: 'text', required: true, position: 13 },
      { key: 'paisNacimiento', label: 'País de nacimiento', type: 'text', required: true, position: 14 },
      { key: 'paisResidencia', label: 'País de residencia', type: 'text', required: true, position: 15 },
      { key: 'tieneConvenio', label: '¿Te corresponde algún convenio?', type: 'select', required: true, position: 16 },
      { key: 'fuente', label: '¿Cómo conociste esta propuesta?', type: 'select', required: true, position: 17 },
      { key: 'aceptaDifusion', label: '¿Autorizás la difusión?', type: 'select', required: true, position: 18 },
      { key: 'estudios', label: 'Estudios cursados', type: 'textarea', required: true, position: 19 },
      { key: 'posgradoFlacso', label: '¿Cursaste algún posgrado en FLACSO?', type: 'select', required: true, position: 20 },
      { key: 'posgradoCual', label: '¿Cuál posgrado?', type: 'text', required: false, position: 21 },
      {
        key: 'orientacion',
        label: 'Orientación',
        type: 'select',
        required: true,
        position: 22,
        optionsSource: 'wordpress.orientaciones',
      },
      {
        key: 'mencion',
        label: 'Mención',
        type: 'select',
        required: false,
        position: 23,
        optionsSource: 'wordpress.menciones',
      },
    ],
    orientations: [
      { id: 'educacion', name: 'Educación', mentions: [] },
      { id: 'politicas', name: 'Políticas Públicas', mentions: [] },
    ],
    mentions: [
      { id: 'tec-edu', name: 'Tecnología Educativa' },
      { id: 'gestion-edu', name: 'Gestión Educativa' },
      { id: 'gestion-pub', name: 'Gestión Pública' },
    ],
  };

  const validValues = {
    nombre1: 'Ana',
    nombre2: '',
    apellido1: 'Pérez',
    apellido2: '',
    email: 'ana@example.com',
    fechaNacimiento: '1980-01-01',
    tipoDocumento: 'cedula_uruguaya',
    documento: '1234567-8',
    paisEmisorDocumento: 'Uruguay',
    genero: 'Mujer',
    etnia: 'No declara',
    celular: '099123456',
    domicilio: 'Montevideo',
    ocupacion: 'Docente',
    paisNacimiento: 'Uruguay',
    paisResidencia: 'Uruguay',
    tieneConvenio: 'No',
    fuente: 'Web',
    aceptaDifusion: 'No',
    estudios: 'Licenciatura',
    posgradoFlacso: 'No',
    posgradoCual: '',
    orientacion: 'educacion',
    mencion: 'tec-edu',
  };

  it('passes when all required values are present and orientation/mention are independent', () => {
    const result = validateSubmission(form, validValues, 'rev-xyz');
    expect(result.valid).toBe(true);
    expect(Object.keys(result.fieldErrors)).toHaveLength(0);
  });

  it('fails when a required value is missing or empty', () => {
    const missingValues = { ...validValues, nombre1: '   ', email: '' };
    const result = validateSubmission(form, missingValues, 'rev-xyz');
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.nombre1).toBeDefined();
    expect(result.fieldErrors.email).toBeDefined();
  });

  it('allows optional values to be empty', () => {
    const withoutOptional = { ...validValues, nombre2: '', apellido2: '', posgradoCual: '', mencion: '' };
    const result = validateSubmission(form, withoutOptional, 'rev-xyz');
    expect(result.valid).toBe(true);
  });

  it('fails when email format is invalid', () => {
    const invalidEmail = { ...validValues, email: 'not-an-email' };
    const result = validateSubmission(form, invalidEmail, 'rev-xyz');
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.email).toBeDefined();
  });

  it('rejects an orientation that does not exist', () => {
    const invalidOrientation = { ...validValues, orientacion: 'inexistente' };
    const result = validateSubmission(form, invalidOrientation, 'rev-xyz');
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.orientacion).toBeDefined();
  });

  it('allows a mention independently of the selected orientation', () => {
    const mismatchedMention = {
      ...validValues,
      orientacion: 'educacion',
      mencion: 'gestion-pub',
    };
    const result = validateSubmission(form, mismatchedMention, 'rev-xyz');
    expect(result.valid).toBe(true);
    expect(result.fieldErrors.mencion).toBeUndefined();
  });

  it('rejects when configRevision does not match current form revision (stale form)', () => {
    const result = validateSubmission(form, validValues, 'old-rev');
    expect(result.valid).toBe(false);
    expect(result.fieldErrors._form).toContain('El formulario ha sido actualizado. Por favor recargue la página.');
  });
});
