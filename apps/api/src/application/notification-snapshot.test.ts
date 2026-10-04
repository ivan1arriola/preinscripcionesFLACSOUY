import { describe, expect, it } from 'vitest';
import {
  buildSubmissionNotificationSnapshot,
  type SubmissionNotificationSnapshot,
  type FormFieldInfo,
} from './notification-snapshot.js';
import type { AcademicTarget } from '@flacso/contracts';

describe('SubmissionNotificationSnapshot', () => {
  const sampleTarget: AcademicTarget = {
    id: 'diploma-educacion-imagenes',
    kind: 'academic_offer',
    title: 'Diploma Superior en Educación, Imágenes y Medios',
    registrationOpen: true,
    notificationEmail: 'coordinacion.educacion@flacso.edu.uy',
    configRevision: 'rev-1',
    orientations: [],
    mentions: [],
  };

  const sampleFields: FormFieldInfo[] = [
    { key: 'nombre', label: 'Nombres', type: 'text', required: true },
    { key: 'apellido', label: 'Apellidos', type: 'text', required: true },
    { key: 'documento', label: 'Documento de identidad', type: 'text', required: true },
    { key: 'email', label: 'Correo electrónico', type: 'email', required: true },
    { key: 'pais', label: 'País de residencia', type: 'select', required: true },
    { key: 'ciudad', label: 'Ciudad', type: 'text', required: true },
    { key: 'titulo_grado', label: 'Título de grado (PDF)', type: 'file', required: false },
  ];

  const samplePayload = {
    nombre: 'Ana',
    apellido: 'Silva',
    documento: '1.234.567-8',
    email: 'Ana.Silva@example.com',
    pais: 'Uruguay',
    ciudad: 'Montevideo',
    titulo_grado: { token: 'upl_secret_token_123' },
  };

  it('builds a frozen snapshot with normalized values, field labels, and clean metadata', () => {
    const snapshot: SubmissionNotificationSnapshot = buildSubmissionNotificationSnapshot({
      submissionId: 'sub_test_001',
      target: sampleTarget,
      fields: sampleFields,
      payload: samplePayload,
      spreadsheetRowUrl: 'https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0&range=5:5',
      documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-abc',
    });

    expect(snapshot.submissionId).toBe('sub_test_001');
    expect(snapshot.targetId).toBe('diploma-educacion-imagenes');
    expect(snapshot.targetTitle).toBe('Diploma Superior en Educación, Imágenes y Medios');
    expect(snapshot.targetKind).toBe('academic_offer');
    expect(snapshot.applicantEmail).toBe('ana.silva@example.com');
    expect(snapshot.applicantName).toBe('Ana Silva');
    expect(snapshot.notificationEmail).toBe('coordinacion.educacion@flacso.edu.uy');
    expect(snapshot.templateVersion).toBe('preinscription-notification-v1');

    // Values should match labels from fields
    expect(snapshot.values['nombre']).toEqual({
      key: 'nombre',
      label: 'Nombres',
      value: 'Ana',
    });
    expect(snapshot.values['documento']).toEqual({
      key: 'documento',
      label: 'Documento de identidad',
      value: '1.234.567-8',
    });
    expect(snapshot.values['email']).toEqual({
      key: 'email',
      label: 'Correo electrónico',
      value: 'ana.silva@example.com',
    });
    expect(snapshot.values['pais']).toEqual({
      key: 'pais',
      label: 'País de residencia',
      value: 'Uruguay',
    });
    expect(snapshot.values['ciudad']).toEqual({
      key: 'ciudad',
      label: 'Ciudad',
      value: 'Montevideo',
    });

    // File field must NOT contain the secret upload token
    expect(snapshot.values['titulo_grado']?.value).not.toContain('upl_secret_token_123');
    expect(snapshot.values['titulo_grado']?.value).toBe('Archivo adjunto');

    // Snapshot links
    expect(snapshot.spreadsheetRowUrl).toBe('https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0&range=5:5');
    expect(snapshot.documentsFolderUrl).toBe('https://drive.google.com/drive/folders/folder-abc');
  });

  it('handles target without notificationEmail returning undefined', () => {
    const targetWithoutEmail: AcademicTarget = {
      ...sampleTarget,
      notificationEmail: undefined,
    };

    const snapshot = buildSubmissionNotificationSnapshot({
      submissionId: 'sub_test_002',
      target: targetWithoutEmail,
      fields: sampleFields,
      payload: samplePayload,
      spreadsheetRowUrl: 'https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0&range=6:6',
      documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-abc',
    });

    expect(snapshot.notificationEmail).toBeUndefined();
  });
});
