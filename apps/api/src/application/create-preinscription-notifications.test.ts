import { describe, expect, it } from 'vitest';
import type { AcademicTarget, FormDefinition } from '@flacso/contracts';
import {
  buildNotificationRecipients,
  createPreinscriptionNotifications,
} from './create-preinscription-notifications.js';
import { InMemoryEmailNotificationRepository } from '../infrastructure/database/in-memory-email-notification-repository.js';

describe('createPreinscriptionNotifications & buildNotificationRecipients', () => {
  describe('buildNotificationRecipients', () => {
    it('creates applicant, target, and master recipients and deduplicates shared addresses', () => {
      const applicant = '  Postulante@Example.com ';
      const target = 'coordinacion@flacso.edu.uy';
      const masters = [
        'coordinacion@flacso.edu.uy', // Duplicate of target!
        'admin@flacso.edu.uy',
        'ADMIN@FLACSO.EDU.UY', // Duplicate of admin!
        'not-an-email',
      ];

      const recipients = buildNotificationRecipients(applicant, target, masters);

      expect(recipients).toEqual([
        { audience: 'applicant', email: 'postulante@example.com' },
        { audience: 'target', email: 'coordinacion@flacso.edu.uy' },
        { audience: 'master', email: 'admin@flacso.edu.uy' },
      ]);
    });

    it('handles target without notificationEmail and empty masters list', () => {
      const recipients = buildNotificationRecipients('postulante@example.com', undefined, []);
      expect(recipients).toEqual([
        { audience: 'applicant', email: 'postulante@example.com' },
      ]);
    });
  });

  describe('createPreinscriptionNotifications', () => {
    const mockTarget: AcademicTarget = {
      id: 'diplomado-edutec',
      kind: 'academic_offer',
      title: 'Diploma Superior en Educación y Tecnología',
      registrationOpen: true,
      notificationEmail: 'edutec@flacso.edu.uy',
      configRevision: 'v1',
      orientations: [],
      mentions: [],
    };

    const mockForm = {
      targetId: 'diplomado-edutec',
      kind: 'academic_offer',
      title: 'Diploma Superior en Educación y Tecnología',
      effectiveRevision: 'v1',
      inputs: [
        { key: 'email', label: 'Correo Electrónico', type: 'email', required: true },
        { key: 'nombre', label: 'Nombre', type: 'text', required: true },
      ],
      documents: [],
    } as unknown as FormDefinition;

    it('creates snapshot and enqueues jobs in the notification repository', async () => {
      const repository = new InMemoryEmailNotificationRepository();

      const jobs = await createPreinscriptionNotifications(repository, {
        submissionId: 'sub_test_enqueue_001',
        target: mockTarget,
        form: mockForm,
        values: {
          email: 'postulante@example.com',
          nombre: 'María',
        },
        spreadsheetRowUrl: 'https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0&range=A5:E5',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-abc',
        masterRecipients: ['admin@flacso.edu.uy'],
      });

      expect(jobs).toHaveLength(3);
      expect(jobs.map((j: { audience: string }) => j.audience)).toEqual(['applicant', 'target', 'master']);
      expect(jobs[0]?.payload.targetTitle).toBe('Diploma Superior en Educación y Tecnología');
      expect(jobs[0]?.payload.spreadsheetRowUrl).toBe(
        'https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0&range=A5:E5'
      );
      expect(jobs[0]?.status).toBe('pending');
    });
  });
});
