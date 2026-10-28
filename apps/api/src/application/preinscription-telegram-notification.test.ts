import { describe, it, expect } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import { InMemoryTelegramAlertRepository } from '../infrastructure/database/in-memory-telegram-alert-repository.js';
import {
  applicantNameFromValues,
  buildPreinscriptionTelegramMessage,
  enqueuePreinscriptionTelegramNotifications,
} from './preinscription-telegram-notification.js';

describe('preinscription-telegram-notification', () => {
  describe('buildPreinscriptionTelegramMessage', () => {
    it('formats offer preinscription message without contact data and with correct label', () => {
      const occurredAt = new Date('2026-10-05T14:30:00.000Z');
      const message = buildPreinscriptionTelegramMessage({
        submissionId: 'sub_test_123',
        targetTitle: 'Diploma Superior en Ciencias Sociales',
        targetKind: 'offer',
        occurredAt,
      });

      expect(message).toContain('✅ Nueva preinscripción recibida');
      expect(message).toContain('ID: sub_test_123');
      expect(message).toContain('Destino: Diploma Superior en Ciencias Sociales');
      expect(message).toContain('Tipo: Oferta académica');
      expect(message).toContain('Fecha: 2026-10-05T14:30:00.000Z');
      expect(message).toContain('Estado: Registrada');

      // Sin nombre cuando no se informa, y nunca datos de contacto ni de acceso
      expect(message).not.toContain('Nombre:');
      expect(message).not.toMatch(/@|\b(cédula|ci|telefono|celular|token|drive|sheets)\b/i);
    });

    it('includes the applicant name, and only the name, when it is provided', () => {
      const message = buildPreinscriptionTelegramMessage({
        submissionId: 'sub_test_name',
        targetTitle: 'Maestría en Género',
        targetKind: 'academic_offer',
        applicantName: 'María José Pérez Gómez',
        occurredAt: new Date('2026-10-05T14:30:00.000Z'),
      });

      expect(message).toContain('Nombre: María José Pérez Gómez');
      expect(message).not.toMatch(/@|\b(cédula|telefono|celular|token|drive|sheets)\b/i);
    });

    it('builds the applicant name from the form values, skipping empty parts and dashes', () => {
      expect(
        applicantNameFromValues({ nombre1: 'María', nombre2: '-', apellido1: ' Pérez ', apellido2: '', email: 'a@b.c' })
      ).toBe('María Pérez');
      expect(applicantNameFromValues({})).toBe('');
      expect(applicantNameFromValues(undefined)).toBe('');
    });

    it('formats seminar preinscription message with correct label', () => {
      const occurredAt = new Date('2026-10-05T14:30:00.000Z');
      const message = buildPreinscriptionTelegramMessage({
        submissionId: 'sub_test_456',
        targetTitle: 'Seminario de Políticas Públicas',
        targetKind: 'seminar',
        occurredAt,
      });

      expect(message).toContain('Tipo: Seminario');
      expect(message).not.toContain('catálogo guardado');
    });

    it('warns when the submission was validated against the cached catalog', () => {
      const message = buildPreinscriptionTelegramMessage({
        submissionId: 'sub_test_789',
        targetTitle: 'Maestría en Género',
        targetKind: 'academic_offer',
        catalogValidation: 'cached',
      });

      expect(message).toContain('se validó contra el catálogo guardado');
    });

    it('safely truncates excessively long target titles', () => {
      const veryLongTitle = 'A'.repeat(200);
      const message = buildPreinscriptionTelegramMessage({
        submissionId: 'sub_test_789',
        targetTitle: veryLongTitle,
        targetKind: 'offer',
        occurredAt: new Date(),
      });

      expect(message.length).toBeLessThan(350);
      expect(message).toContain('Destino: AAAAAAAAAAAAAAAAAAAA');
      expect(message).toContain('...');
    });
  });

  describe('enqueuePreinscriptionTelegramNotifications', () => {
    const mockTarget: AcademicTarget = {
      id: 'target_abc',
      title: 'Maestría en Educación',
      kind: 'academic_offer',
      registrationOpen: true,
      configRevision: 'rev-1',
      orientations: [],
      mentions: [],
    };

    it('enqueues one job per chat ID with preinscription event type and correct dedupe key', async () => {
      const repository = new InMemoryTelegramAlertRepository();
      const occurredAt = new Date('2026-10-05T15:00:00.000Z');

      const alerts = await enqueuePreinscriptionTelegramNotifications({
        repository,
        submissionId: 'sub_001',
        target: mockTarget,
        chatIds: ['1001', '1002'],
        occurredAt,
      });

      expect(alerts).toHaveLength(2);
      expect(alerts[0]!.chatId).toBe('1001');
      expect(alerts[0]!.eventType).toBe('preinscription');
      expect(alerts[0]!.dedupeKey).toBe('sub_001:1001:preinscription');
      expect(alerts[1]!.chatId).toBe('1002');
      expect(alerts[1]!.eventType).toBe('preinscription');
      expect(alerts[1]!.dedupeKey).toBe('sub_001:1002:preinscription');
    });

    it('is idempotent when called repeatedly with the same submission and chat IDs', async () => {
      const repository = new InMemoryTelegramAlertRepository();

      const run1 = await enqueuePreinscriptionTelegramNotifications({
        repository,
        submissionId: 'sub_dup',
        target: mockTarget,
        chatIds: ['1001', '1002'],
      });

      const run2 = await enqueuePreinscriptionTelegramNotifications({
        repository,
        submissionId: 'sub_dup',
        target: mockTarget,
        chatIds: ['1001', '1002'],
      });

      expect(run2.map((a) => a.id)).toEqual(run1.map((a) => a.id));
      expect(repository.alerts).toHaveLength(2);
    });

    it('returns empty array if no chat IDs are provided', async () => {
      const repository = new InMemoryTelegramAlertRepository();

      const alerts = await enqueuePreinscriptionTelegramNotifications({
        repository,
        submissionId: 'sub_none',
        target: mockTarget,
        chatIds: [],
      });

      expect(alerts).toHaveLength(0);
      expect(repository.alerts).toHaveLength(0);
    });
  });
});
