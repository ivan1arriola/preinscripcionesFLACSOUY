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
      { key: 'generoOtra', label: 'Especifique su identidad de género', type: 'text', required: false, position: 10 },
      { key: 'etnia', label: 'Raza / etnia', type: 'text', required: true, position: 10 },
      { key: 'celular', label: 'Celular', type: 'tel', required: true, position: 11 },
      { key: 'domicilio', label: 'Domicilio', type: 'text', required: true, position: 12 },
      { key: 'ocupacion', label: 'Ocupación actual', type: 'text', required: true, position: 13 },
      { key: 'paisNacimiento', label: 'País de nacimiento', type: 'text', required: true, position: 14 },
      { key: 'paisResidencia', label: 'País de residencia', type: 'text', required: true, position: 15 },
      { key: 'tieneConvenio', label: '¿Te corresponde algún convenio?', type: 'select', required: true, position: 16 },
      { key: 'convenioWordpressId', label: '¿Cuál convenio te corresponde?', type: 'text', required: false, position: 17 },
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
    orientations: ['educacion', 'politicas'],
    mentions: ['tec-edu', 'gestion-edu', 'gestion-pub'],
    offerType: 'diploma',
    profileVersionId: 'ver_diploma_v1',
    effectiveRevision: 'sha256:effective_rev_test',
    steps: [],
    documents: [],
  };

  const validValues = {
    nombre1: 'Ana',
    nombre2: '',
    apellido1: 'Pérez',
    apellido2: '',
    email: 'ana@example.com',
    fechaNacimiento: '1980-01-01',
    tipoDocumento: 'cedula_uruguaya',
    documento: '34567894',
    paisEmisorDocumento: 'Uruguay',
    genero: 'Mujer',
    generoOtra: '',
    etnia: 'No declara',
    celular: '+59899123456',
    domicilio: 'Montevideo',
    ocupacion: 'Docente',
    paisNacimiento: 'Uruguay',
    paisResidencia: 'Uruguay',
    tieneConvenio: 'No',
    convenioWordpressId: '',
    fuente: 'Web',
    aceptaDifusion: 'No',
    aceptaComunicaciones: 'Si',
    estudios: 'Licenciatura',
    posgradoFlacso: 'No',
    posgradoCual: '',
    orientacion: 'educacion',
    mencion: 'tec-edu',
  };

  it('passes when all required values are present and orientation/mention are independent', () => {
    const result = validateSubmission(form, validValues, form.effectiveRevision);
    expect(result.valid).toBe(true);
    expect(Object.keys(result.fieldErrors)).toHaveLength(0);
  });

  it('fails when a required value is missing or empty', () => {
    const missingValues = { ...validValues, nombre1: '   ', email: '' };
    const result = validateSubmission(form, missingValues, form.effectiveRevision);
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.nombre1).toBeDefined();
    expect(result.fieldErrors.email).toBeDefined();
  });

  it('allows optional values to be empty', () => {
    const withoutOptional = { ...validValues, nombre2: '', apellido2: '', posgradoCual: '', mencion: '' };
    const result = validateSubmission(form, withoutOptional, form.effectiveRevision);
    expect(result.valid).toBe(true);
  });

  it('fails when email format is invalid', () => {
    const invalidEmail = { ...validValues, email: 'not-an-email' };
    const result = validateSubmission(form, invalidEmail, form.effectiveRevision);
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.email).toBeDefined();
  });

  it('rejects an orientation that does not exist', () => {
    const invalidOrientation = { ...validValues, orientacion: 'inexistente' };
    const result = validateSubmission(form, invalidOrientation, form.effectiveRevision);
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.orientacion).toBeDefined();
  });

  it('allows a mention independently of the selected orientation', () => {
    const mismatchedMention = {
      ...validValues,
      orientacion: 'educacion',
      mencion: 'gestion-pub',
    };
    const result = validateSubmission(form, mismatchedMention, form.effectiveRevision);
    expect(result.valid).toBe(true);
    expect(result.fieldErrors.mencion).toBeUndefined();
  });

  it('rejects when configRevision does not match current form revision (stale form)', () => {
    const result = validateSubmission(form, validValues, 'old-rev');
    expect(result.valid).toBe(false);
    expect(result.fieldErrors._form).toContain('El formulario ha sido actualizado. Por favor recargue la página.');
  });

  it('requires conditional details for document, gender, agreement and postgraduate answers', () => {
    const result = validateSubmission(form, {
      ...validValues,
      tipoDocumento: 'pasaporte',
      paisEmisorDocumento: '',
      genero: 'Otra',
      generoOtra: '',
      tieneConvenio: 'Si',
      convenioWordpressId: '',
      posgradoFlacso: 'Si',
      posgradoCual: '',
    }, form.effectiveRevision);

    expect(result.valid).toBe(false);
    expect(result.fieldErrors.paisEmisorDocumento).toBeDefined();
    expect(result.fieldErrors.generoOtra).toBeDefined();
    expect(result.fieldErrors.convenioWordpressId).toBeDefined();
    expect(result.fieldErrors.posgradoCual).toBeDefined();
  });

  it('rejects unsupported document and select values', () => {
    const result = validateSubmission(form, {
      ...validValues,
      tipoDocumento: 'documento-inventado',
      genero: 'identidad-inventada',
      aceptaDifusion: 'Tal vez',
      posgradoFlacso: 'Quizás',
    }, form.effectiveRevision);

    expect(result.valid).toBe(false);
    expect(result.fieldErrors.tipoDocumento).toBeDefined();
    expect(result.fieldErrors.genero).toBeDefined();
    expect(result.fieldErrors.aceptaDifusion).toBeDefined();
    expect(result.fieldErrors.posgradoFlacso).toBeDefined();
  });

  it('rejects an invalid Uruguayan identity card and a non-international phone number', () => {
    const result = validateSubmission(form, {
      ...validValues,
      documento: '34567890',
      celular: '123',
    }, form.effectiveRevision);

    expect(result.valid).toBe(false);
    expect(result.fieldErrors.documento).toContain('La cédula o su dígito verificador no son válidos.');
    expect(result.fieldErrors.celular).toContain('Ingresá un número de teléfono válido con su código de país.');
  });

  it('validates required ciudadResidencia', () => {
    const formWithCiudad: FormDefinition = {
      ...form,
      inputs: [
        ...form.inputs,
        { key: 'ciudadResidencia', label: 'Ciudad de residencia', type: 'text', required: true, position: 24 },
      ],
    };
    const invalidValues = { ...validValues, ciudadResidencia: '' };
    const result = validateSubmission(formWithCiudad, invalidValues);
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.ciudadResidencia).toBeDefined();
    expect(result.fieldErrors.ciudadResidencia![0]).toMatch(/obligatorio/i);
  });

  it('accepts both effectiveRevision and raw configRevision', () => {
    const resultEffective = validateSubmission(form, validValues, form.effectiveRevision);
    expect(resultEffective.fieldErrors._form).toBeUndefined();

    const resultRaw = validateSubmission(form, validValues, form.configRevision);
    expect(resultRaw.fieldErrors._form).toBeUndefined();

    const resultMismatch = validateSubmission(form, validValues, 'stale-rev');
    expect(resultMismatch.fieldErrors._form).toBeDefined();
  });

  it('rejects more files in a document than its limit, even if each upload passed alone', () => {
    const withDocs: FormDefinition = {
      ...form,
      documents: [
        { key: 'cedula', label: 'Cédula', required: false, maxFiles: 2 },
        { key: 'cv', label: 'CV', required: false },
      ],
    };
    const ok = validateSubmission(withDocs, validValues, form.effectiveRevision, ['cedula', 'cedula', 'cv']);
    expect(ok.fieldErrors.cedula).toBeUndefined();
    expect(ok.fieldErrors.cv).toBeUndefined();

    const tooMany = validateSubmission(withDocs, validValues, form.effectiveRevision, ['cedula', 'cedula', 'cedula', 'cv', 'cv']);
    expect(tooMany.fieldErrors.cedula).toHaveLength(1);
    expect(tooMany.fieldErrors.cv).toHaveLength(1);
  });
});
