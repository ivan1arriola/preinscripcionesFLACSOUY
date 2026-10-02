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
      { key: 'nombre', label: 'Nombre', type: 'text', required: true, position: 1 },
      { key: 'apellido', label: 'Apellido', type: 'text', required: true, position: 2 },
      { key: 'email', label: 'Correo electrónico', type: 'email', required: true, position: 3 },
      { key: 'telefono', label: 'Teléfono', type: 'tel', required: false, position: 4 },
      { key: 'documento', label: 'Documento', type: 'text', required: true, position: 5 },
      {
        key: 'orientacion',
        label: 'Orientación',
        type: 'select',
        required: true,
        position: 6,
        optionsSource: 'wordpress.orientaciones',
      },
      {
        key: 'mencion',
        label: 'Mención',
        type: 'select',
        required: false,
        position: 7,
        optionsSource: 'wordpress.menciones',
      },
    ],
    orientations: [
      {
        id: 'educacion',
        name: 'Educación',
        mentions: [
          { id: 'tec-edu', name: 'Tecnología Educativa' },
          { id: 'gestion-edu', name: 'Gestión Educativa' },
        ],
      },
      {
        id: 'politicas',
        name: 'Políticas Públicas',
        mentions: [{ id: 'gestion-pub', name: 'Gestión Pública' }],
      },
    ],
  };

  const validValues = {
    nombre: 'Ana',
    apellido: 'Pérez',
    email: 'ana@example.com',
    telefono: '099123456',
    documento: '1234567-8',
    orientacion: 'educacion',
    mencion: 'tec-edu',
  };

  it('passes when all required values are present and orientation/mention are consistent', () => {
    const result = validateSubmission(form, validValues, 'rev-xyz');
    expect(result.valid).toBe(true);
    expect(Object.keys(result.fieldErrors)).toHaveLength(0);
  });

  it('fails when a required value is missing or empty', () => {
    const missingValues = { ...validValues, nombre: '   ', email: '' };
    const result = validateSubmission(form, missingValues, 'rev-xyz');
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.nombre).toBeDefined();
    expect(result.fieldErrors.email).toBeDefined();
  });

  it('allows optional values to be empty', () => {
    const withoutOptional = { ...validValues, telefono: '', mencion: '' };
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

  it('rejects a mention belonging to a different orientation', () => {
    // 'gestion-pub' belongs to 'politicas', but orientation is 'educacion'
    const mismatchedMention = {
      ...validValues,
      orientacion: 'educacion',
      mencion: 'gestion-pub',
    };
    const result = validateSubmission(form, mismatchedMention, 'rev-xyz');
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.mencion).toBeDefined();
  });

  it('rejects when configRevision does not match current form revision (stale form)', () => {
    const result = validateSubmission(form, validValues, 'old-rev');
    expect(result.valid).toBe(false);
    expect(result.fieldErrors._form).toContain('El formulario ha sido actualizado. Por favor recargue la página.');
  });
});
