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

  it('omits orientation in applicant and operational emails, including old snapshots', () => {
    const snapshot: SubmissionNotificationSnapshot = {
      ...sampleSnapshot,
      orderedFieldKeys: [...sampleSnapshot.orderedFieldKeys!, 'orientacion', 'mencion'],
      values: {
        ...sampleSnapshot.values,
        orientacion: { key: 'orientacion', label: 'Orientación', value: 'Orientación anterior' },
        mencion: { key: 'mencion', label: 'Mención', value: 'Mención actual' },
      },
    };
    for (const message of [renderApplicantNotification(snapshot), renderOperationalNotification(snapshot, 'target', 'test@example.com')]) {
      for (const body of [message.text, message.html]) {
        expect(body).not.toContain('Orientación');
        expect(body).toContain('Mención actual');
      }
    }
  });

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

      expect(rendered.text).toContain('sub_xyz_789');
      expect(rendered.html).toContain('sub_xyz_789');

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

  describe('Layout con los campos canónicos del formulario', () => {
    const field = (key: string, label: string, value: string) => ({ key, label, value });
    const canonical: SubmissionNotificationSnapshot = {
      ...sampleSnapshot,
      applicantName: 'Franco Vignolo',
      applicantEmail: 'franco@example.com',
      orderedFieldKeys: [
        'nombre1', 'nombre2', 'apellido1', 'tipoDocumento', 'documento', 'celular', 'email',
        'ciudadResidencia', 'paisResidencia', 'estudios', 'tieneConvenio', 'convenioWordpressId',
        'aceptaComunicaciones', 'identidad', 'cv', 'cartaMotivacion',
      ],
      values: {
        nombre1: field('nombre1', 'Primer nombre', 'Franco'),
        nombre2: field('nombre2', 'Segundo nombre', '-'),
        apellido1: field('apellido1', 'Primer apellido', 'Vignolo'),
        tipoDocumento: field('tipoDocumento', 'Tipo de documento', 'cedula_uruguaya'),
        documento: field('documento', 'Número de documento', '5.081.244-9'),
        celular: field('celular', 'Celular', '+59898010671'),
        email: field('email', 'Correo electrónico', 'franco@example.com'),
        ciudadResidencia: field('ciudadResidencia', 'Ciudad de residencia', 'Montevideo'),
        paisResidencia: field('paisResidencia', 'País de residencia', 'Uruguay'),
        estudios: field('estudios', 'Estudios cursados', 'Licenciatura'),
        tieneConvenio: field('tieneConvenio', '¿Te corresponde algún convenio?', 'No'),
        convenioWordpressId: field('convenioWordpressId', '¿Cuál convenio te corresponde?', '-'),
        aceptaComunicaciones: field('aceptaComunicaciones', '¿Querés recibir novedades?', 'No'),
        identidad: field('identidad', 'Documento de identidad', 'Archivo adjunto'),
        cv: field('cv', 'Curriculum Vitae', '-'),
        cartaMotivacion: field('cartaMotivacion', 'Carta de motivación', '-'),
      },
    };

    it('abre con un resumen y botones, y agrupa los campos en secciones', () => {
      const { html, text } = renderOperationalNotification(canonical, 'target', 'coordinacion@flacso.edu.uy');

      // Resumen con lo que más se busca
      expect(html).toContain('mailto:franco@example.com');
      expect(html).toContain('href="tel:+59898010671"');
      expect(html).toContain('https://wa.me/59898010671');
      expect(html).toContain('Cédula uruguaya 5.081.244-9');
      expect(html).toContain('Montevideo, Uruguay');
      expect(html).toContain('1 de 3 adjuntos');
      expect(text).toContain('Documento: Cédula uruguaya 5.081.244-9');
      expect(text).toContain('Acepta novedades por correo: No');

      // Botones y orden: resumen, botones, secciones
      expect(html).toContain('>Abrir planilla</a>');
      expect(html).toContain('>Abrir documentación</a>');
      expect(html.indexOf('Abrir planilla')).toBeLessThan(html.indexOf('Datos personales'));
      for (const title of ['Datos personales', 'Contacto y residencia', 'Formación', 'Convenio y consentimientos', 'Documentos']) {
        expect(html).toContain(title);
      }
    });

    it('junta los campos sin respuesta y muestra el estado de cada documento', () => {
      const { html, text } = renderOperationalNotification(canonical, 'master', 'master@flacso.edu.uy');

      expect(html).not.toContain('No completados:');
      expect(text).not.toContain('No completados:');
      expect(html).not.toContain('>-</td>');
      expect(html).toContain('&#10003; Adjunto');
      expect(html).toContain('&#10007; No adjunto');
      expect(text).toContain('Documento de identidad: Adjunto');
      expect(text).toContain('Curriculum Vitae: No adjunto');
    });

    it('no convierte en enlace una dirección con un esquema peligroso', () => {
      const hostile = {
        ...canonical,
        spreadsheetRowUrl: 'javascript:alert(1)',
        documentsFolderUrl: 'https://drive.google.com/drive/folders/folder-id-abc',
      };
      const { html } = renderOperationalNotification(hostile, 'target', 'coordinacion@flacso.edu.uy');

      expect(html).not.toContain('javascript:');
      expect(html).not.toContain('Abrir planilla');
      expect(html).toContain('Abrir documentación');
    });

    it('la confirmación al postulante también agrupa, oculta lo vacío y nunca expone enlaces internos', () => {
      const { html, text } = renderApplicantNotification(canonical);

      expect(html).toContain('¿Qué sigue?');
      expect(html).toContain('Datos personales');
      expect(html).toContain('Cédula uruguaya');
      expect(html).not.toContain('No completados:');
      expect(text).toContain('inscripciones@flacso.edu.uy');
      expect(html).not.toContain('sub_xyz_789');
      expect(text).not.toContain('sub_xyz_789');
      expect(html).not.toContain('docs.google.com');
      expect(html).not.toContain('Abrir planilla');
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
