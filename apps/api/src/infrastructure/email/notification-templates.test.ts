import { describe, expect, it } from 'vitest';
import {
  renderApplicantNotification,
  renderOperationalNotification,
  renderAllNotifications,
} from './notification-templates.js';
import type { SubmissionNotificationSnapshot } from '../../application/notification-snapshot.js';

describe('Notification Templates', () => {
  const sampleSnapshot: SubmissionNotificationSnapshot = {
    submissionId: 'sub_xyz_789',
    targetId: 'diploma-educacion-imagenes',
    targetTitle: 'Diploma Superior en Educación, Imágenes y Medios',
    targetKind: 'academic_offer',
    applicantEmail: 'postulante@example.com',
    applicantName: 'Ana Silva',
    notificationEmails: ['coordinacion@flacso.edu.uy'],
    orderedFieldKeys: ['nombre', 'apellido', 'documento', 'email', 'pais', 'ciudad'],
    values: {
      nombre: { key: 'nombre', label: 'Nombres', value: 'Ana <script>alert(1)</script>' },
      apellido: { key: 'apellido', label: 'Apellidos', value: 'Silva' },
      documento: { key: 'documento', label: 'Documento', value: '1.234.567-8' },
      email: { key: 'email', label: 'Correo', value: 'postulante@example.com' },
      pais: { key: 'pais', label: 'País', value: 'Uruguay' },
      ciudad: { key: 'ciudad', label: 'Ciudad', value: 'Montevideo & Canelones' },
    },
    spreadsheetRowUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123/edit#gid=0&range=10:10',
    documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-id-abc',
    templateVersion: 'preinscription-notification-v1',
  };

  describe('Applicant notification', () => {
    it('renders applicant confirmation with user data and target title', () => {
      const rendered = renderApplicantNotification(sampleSnapshot);

      expect(rendered.audience).toBe('applicant');
      expect(rendered.to).toBe('postulante@example.com');
      expect(rendered.subject).toContain('Diploma Superior en Educación, Imágenes y Medios');
      expect(rendered.tags).toEqual({
        audience: 'applicant',
        submissionId: 'sub_xyz_789',
        targetId: 'diploma-educacion-imagenes',
      });

      // Contains applicant data
      expect(rendered.text).toContain('Ana <script>alert(1)</script>');
      expect(rendered.text).toContain('1.234.567-8');
      expect(rendered.html).toContain('Ana &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(rendered.html).toContain('Montevideo &amp; Canelones');

      // CRITICAL: MUST NEVER contain Google Drive, Google Sheets, internal IDs or tokens
      expect(rendered.text).not.toContain('docs.google.com');
      expect(rendered.text).not.toContain('drive.google.com');
      expect(rendered.text).not.toContain('sheet-id-123');
      expect(rendered.text).not.toContain('folder-id-abc');
      expect(rendered.html).not.toContain('docs.google.com');
      expect(rendered.html).not.toContain('drive.google.com');
      expect(rendered.html).not.toContain('sheet-id-123');
      expect(rendered.html).not.toContain('folder-id-abc');
    });
  });

  describe('Operational notification (target & master)', () => {
    it('renders direct spreadsheet row and drive folder URLs for operational audience', () => {
      const rendered = renderOperationalNotification(sampleSnapshot, 'target', 'coordinacion@flacso.edu.uy');

      expect(rendered.audience).toBe('target');
      expect(rendered.to).toBe('coordinacion@flacso.edu.uy');
      expect(rendered.subject).toContain('[Preinscripción]');
      expect(rendered.subject).toContain('Ana Silva');
      expect(rendered.subject).toContain('Diploma Superior en Educación');

      // MUST contain operational links
      expect(rendered.text).toContain('https://docs.google.com/spreadsheets/d/sheet-id-123/edit#gid=0&range=10:10');
      expect(rendered.text).toContain('https://drive.google.com/drive/folders/folder-id-abc');
      expect(rendered.html).toContain('https://docs.google.com/spreadsheets/d/sheet-id-123/edit#gid=0&amp;range=10:10');
      expect(rendered.html).toContain('https://drive.google.com/drive/folders/folder-id-abc');

      // Contains full applicant data with HTML escaping
      expect(rendered.text).toContain('1.234.567-8');
      expect(rendered.html).toContain('Ana &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(rendered.html).toContain('Montevideo &amp; Canelones');
    });
  });

  describe('renderAllNotifications', () => {
    it('creates applicant, target, and master notifications without duplicates', () => {
      const masterEmails = ['master1@flacso.edu.uy', 'coordinacion@flacso.edu.uy', 'master2@flacso.edu.uy'];
      const notifications = renderAllNotifications(sampleSnapshot, masterEmails);

      expect(notifications).toHaveLength(4); // 1 applicant, 1 target, 2 distinct masters (coordinacion is not duplicated)
      expect(notifications[0]?.audience).toBe('applicant');
      expect(notifications[0]?.to).toBe('postulante@example.com');

      expect(notifications[1]?.audience).toBe('target');
      expect(notifications[1]?.to).toBe('coordinacion@flacso.edu.uy');

      const masterNotifs = notifications.filter((n) => n.audience === 'master');
      expect(masterNotifs.map((n) => n.to)).toEqual(['master1@flacso.edu.uy', 'master2@flacso.edu.uy']);
    });

    it('sends one target notification per offer email', () => {
      const notifications = renderAllNotifications(
        { ...sampleSnapshot, notificationEmails: ['coordinacion@flacso.edu.uy', 'secretaria@flacso.edu.uy'] },
        ['secretaria@flacso.edu.uy']
      );
      expect(notifications.filter((n) => n.audience === 'target').map((n) => n.to)).toEqual([
        'coordinacion@flacso.edu.uy',
        'secretaria@flacso.edu.uy',
      ]);
      expect(notifications.some((n) => n.audience === 'master')).toBe(false);
    });

    it('omits target notification if snapshot does not have notification emails', () => {
      const snapshotWithoutTargetEmail = {
        ...sampleSnapshot,
        notificationEmails: [],
      };

      const notifications = renderAllNotifications(snapshotWithoutTargetEmail, ['master@flacso.edu.uy']);
      expect(notifications).toHaveLength(2); // 1 applicant, 1 master
      expect(notifications.some((n) => n.audience === 'target')).toBe(false);
      expect(notifications[1]?.to).toBe('master@flacso.edu.uy');
    });
  });
});
