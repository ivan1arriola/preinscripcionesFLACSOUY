import type {
  SubmissionNotificationSnapshot,
  NotificationAudience,
} from '../../application/notification-snapshot.js';

export interface RenderedNotification {
  audience: NotificationAudience;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string[];
  tags: Record<string, string>;
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const CONTACT_EMAIL = 'inscripciones@flacso.edu.uy';

/** Valor que el snapshot guarda para un campo sin respuesta. */
const EMPTY_VALUE = '-';
const ATTACHED_VALUE = 'Archivo adjunto';

function escapeHtml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Sólo enlaces http(s): nunca un esquema que ejecute código. */
function safeUrl(url: string): string {
  const trimmed = (url ?? '').trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

interface Section {
  id: string;
  title: string;
  keys: string[];
}

/** Los campos conocidos del formulario, agrupados como los ve quien revisa la postulación. */
const SECTIONS: Section[] = [
  {
    id: 'personal',
    title: 'Datos personales',
    keys: [
      'nombre1', 'nombre2', 'apellido1', 'apellido2', 'fechaNacimiento', 'tipoDocumento',
      'paisEmisorDocumento', 'documento', 'genero', 'generoOtra', 'etnia', 'paisNacimiento',
    ],
  },
  {
    id: 'contacto',
    title: 'Contacto y residencia',
    keys: ['paisResidencia', 'ciudadResidencia', 'celular', 'email', 'ocupacion'],
  },
  {
    id: 'formacion',
    title: 'Formación',
    keys: [
      'estudios', 'posgradoFlacso', 'posgradoCual', 'tituloDenominacion', 'sinTituloActual',
      'mencion',
    ],
  },
  {
    id: 'declaracion',
    title: 'Convenio y consentimientos',
    keys: ['tieneConvenio', 'convenioWordpressId', 'fuente', 'aceptaDifusion', 'aceptaComunicaciones'],
  },
];

/** Campos que solo se solicitan si se cumple su condición. */
const OPTIONAL_KEYS = new Set(['nombre2', 'apellido2', 'generoOtra', 'posgradoCual', 'mencion', 'convenioWordpressId']);

function isApplicable(key: string, snapshot: SubmissionNotificationSnapshot): boolean {
  const answer = (field: string) => snapshot.values[field]?.value?.trim().toLowerCase() ?? '';
  if (key === 'generoOtra') return ['otra', 'otro', 'other'].includes(answer('genero'));
  if (key === 'posgradoCual') return ['sí', 'si'].includes(answer('posgradoFlacso'));
  if (key === 'convenioWordpressId') return ['sí', 'si'].includes(answer('tieneConvenio'));
  return true;
}

const DOCUMENT_KEYS = ['identidad', 'cv', 'titulo', 'cartaMotivacion', 'cartaRecomendacion1', 'cartaRecomendacion2'];

const HUMAN_VALUES: Record<string, string> = {
  cedula_uruguaya: 'Cédula uruguaya',
  dni: 'DNI',
};

/** «cedula_uruguaya» → «Cédula uruguaya»; el resto de los valores queda como llegó. */
function humanizeValue(value: string): string {
  const known = HUMAN_VALUES[value];
  if (known) return known;
  if (!/^[a-z]+(_[a-z]+)+$/.test(value)) return value;
  const words = value.split('_').map((word) => (word === 'cedula' ? 'cédula' : word));
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

interface Row {
  key: string;
  label: string;
  value: string;
}

interface DocumentRow {
  label: string;
  attached: boolean;
}

interface NotificationModel {
  sections: { title: string; rows: Row[] }[];
  documents: DocumentRow[];
  missing: string[];
}

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value === '' || value === EMPTY_VALUE;
}

/**
 * Ordena los datos del snapshot: cada campo en su sección, los documentos aparte
 * (con su estado) y los campos sin respuesta juntos, para que el correo sea corto.
 */
function buildModel(snapshot: SubmissionNotificationSnapshot): NotificationModel {
  const orderedKeys = snapshot.orderedFieldKeys?.length ? snapshot.orderedFieldKeys : Object.keys(snapshot.values);
  const known = new Map<string, string>();
  for (const section of SECTIONS) for (const key of section.keys) known.set(key, section.id);

  const bySection = new Map<string, Row[]>();
  const other: Row[] = [];
  const documents: DocumentRow[] = [];
  const missing: string[] = [];

  for (const key of orderedKeys) {
    if (key === 'orientacion') continue;
    const item = snapshot.values[key];
    if (!item) continue;

    const isDocument = DOCUMENT_KEYS.includes(key) || item.value === ATTACHED_VALUE;
    if (isDocument) {
      documents.push({ label: item.label, attached: item.value === ATTACHED_VALUE });
      continue;
    }
    if (isEmpty(item.value)) {
      if (!OPTIONAL_KEYS.has(key) && isApplicable(key, snapshot)) missing.push(item.label);
      continue;
    }

    const row: Row = { key, label: item.label, value: humanizeValue(item.value) };
    const sectionId = known.get(key);
    if (sectionId) {
      const rows = bySection.get(sectionId) ?? [];
      rows.push(row);
      bySection.set(sectionId, rows);
    } else {
      other.push(row);
    }
  }

  const sections = SECTIONS.map((section) => ({ title: section.title, rows: bySection.get(section.id) ?? [] }));
  sections.push({ title: 'Otros datos', rows: other });

  return { sections: sections.filter((section) => section.rows.length > 0), documents, missing };
}

function valueOf(snapshot: SubmissionNotificationSnapshot, key: string): string {
  const value = snapshot.values[key]?.value;
  return isEmpty(value) ? '' : humanizeValue(value ?? '');
}

interface SummaryEntry {
  label: string;
  html: string;
  text: string;
}

/** Lo que más se busca al revisar una postulación, antes de la tabla completa. */
function buildSummary(snapshot: SubmissionNotificationSnapshot, model: NotificationModel): SummaryEntry[] {
  const entries: SummaryEntry[] = [];
  const add = (label: string, html: string, text: string): void => {
    if (text) entries.push({ label, html, text });
  };

  const name = snapshot.applicantName || '';
  add('Postulante', `<strong>${escapeHtml(name || snapshot.applicantEmail)}</strong>`, name || snapshot.applicantEmail);

  const email = snapshot.applicantEmail;
  add('Correo', `<a href="mailto:${escapeHtml(email)}" style="color: #175cd3; text-decoration: none;">${escapeHtml(email)}</a>`, email);

  const phone = valueOf(snapshot, 'celular');
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    const whatsapp = digits.length >= 8
      ? ` · <a href="https://wa.me/${digits}" style="color: #175cd3; text-decoration: none;">WhatsApp</a>`
      : '';
    add(
      'Celular',
      `<a href="tel:${escapeHtml(`+${digits}`)}" style="color: #175cd3; text-decoration: none;">${escapeHtml(phone)}</a>${whatsapp}`,
      phone,
    );
  }

  const documentNumber = valueOf(snapshot, 'documento');
  if (documentNumber) {
    const kind = valueOf(snapshot, 'tipoDocumento');
    const text = [kind, documentNumber].filter(Boolean).join(' ');
    add('Documento', escapeHtml(text), text);
  }

  const residence = [valueOf(snapshot, 'ciudadResidencia'), valueOf(snapshot, 'paisResidencia')].filter(Boolean).join(', ');
  add('Residencia', escapeHtml(residence), residence);

  const convenio = valueOf(snapshot, 'tieneConvenio');
  if (convenio) {
    const which = valueOf(snapshot, 'convenioWordpressId');
    const text = which && !/^no$/i.test(convenio) ? `${convenio} — convenio ${which}` : convenio;
    add('Convenio', escapeHtml(text), text);
  }

  const news = valueOf(snapshot, 'aceptaComunicaciones');
  add('Acepta novedades por correo', escapeHtml(news), news);

  if (model.documents.length > 0) {
    const attached = model.documents.filter((doc) => doc.attached).length;
    const text = `${attached} de ${model.documents.length} adjuntos`;
    add('Documentos', escapeHtml(text), text);
  }

  return entries;
}

function renderRowsTable(rows: Row[]): string {
  const body = rows
    .map(
      (row) => `<tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #475467; border-bottom: 1px solid #eaecf0; width: 40%; vertical-align: top; overflow-wrap: anywhere;">${escapeHtml(row.label)}</td>
          <td style="padding: 8px 12px; color: #101828; border-bottom: 1px solid #eaecf0; vertical-align: top; overflow-wrap: anywhere; word-break: break-word;">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed;"><tbody>${body}</tbody></table>`;
}

function renderSectionHtml(title: string, content: string): string {
  return `<div style="margin-bottom: 26px;">
      <h3 style="margin: 0 0 8px 0; padding-bottom: 6px; border-bottom: 1px solid #d8e2ef; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #475467;">${escapeHtml(title)}</h3>
      ${content}
    </div>`;
}

function renderDocumentsHtml(documents: DocumentRow[]): string {
  const rows = documents
    .map((doc) => {
      const badge = doc.attached
        ? '<span style="color: #027a48; font-weight: 600;">&#10003; Adjunto</span>'
        : '<span style="color: #b54708; font-weight: 600;">&#10007; No adjunto</span>';
      return `<tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #475467; border-bottom: 1px solid #eaecf0; width: 35%;">${escapeHtml(doc.label)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eaecf0;">${badge}</td>
        </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed;"><tbody>${rows}</tbody></table>`;
}

function renderMissingHtml(missing: string[]): string {
  if (missing.length === 0) return '';
  return `<p style="margin: 0 0 8px 0; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; color: #475467;"><strong>No completados:</strong> ${escapeHtml(missing.join(', '))}</p>`;
}

function renderButton(label: string, url: string, primary: boolean): string {
  const href = safeUrl(url);
  if (!href) return '';
  const colors = primary
    ? 'background: #175cd3; color: #ffffff; border: 1px solid #175cd3;'
    : 'background: #ffffff; color: #175cd3; border: 1px solid #175cd3;';
  return `<a href="${escapeHtml(href)}" target="_blank" style="display: inline-block; margin: 0 8px 8px 0; padding: 12px 18px; border-radius: 7px; font-size: 14px; font-weight: 600; text-decoration: none; ${colors}">${escapeHtml(label)}</a>`;
}

function renderSectionsText(model: NotificationModel): string[] {
  const lines: string[] = [];
  for (const section of model.sections) {
    lines.push(section.title.toUpperCase(), '--------------------------------------------------');
    for (const row of section.rows) lines.push(`${row.label}: ${row.value}`);
    lines.push('');
  }
  if (model.documents.length > 0) {
    lines.push('DOCUMENTOS', '--------------------------------------------------');
    for (const doc of model.documents) lines.push(`${doc.label}: ${doc.attached ? 'Adjunto' : 'No adjunto'}`);
    lines.push('');
  }
  if (model.missing.length > 0) {
    lines.push(`No completados: ${model.missing.join(', ')}`, '');
  }
  return lines;
}

function renderSectionsHtml(model: NotificationModel): string {
  const parts = model.sections.map((section) => renderSectionHtml(section.title, renderRowsTable(section.rows)));
  if (model.documents.length > 0) {
    parts.push(renderSectionHtml('Documentos', renderDocumentsHtml(model.documents)));
  }
  parts.push(renderMissingHtml(model.missing));
  return parts.join('\n    ');
}

export function renderApplicantNotification(
  snapshot: SubmissionNotificationSnapshot
): RenderedNotification {
  const subject = `Confirmación de preinscripción — ${snapshot.targetTitle}`;
  const greetingName = snapshot.applicantName || 'Estimado/a postulante';
  const model = buildModel(snapshot);

  const textLines: string[] = [
    `Hola ${greetingName},`,
    '',
    `Hemos recibido correctamente tu solicitud de preinscripción para:`,
    `${snapshot.targetTitle}`,
    '',
    'A continuación detallamos los datos registrados:',
    '',
    ...renderSectionsText(model),
    'Nos pondremos en contacto a la brevedad con los siguientes pasos del proceso de admisión.',
    `Si algún dato es incorrecto, escribinos a ${CONTACT_EMAIL}.`,
    '',
    'Saludos cordiales,',
    'Equipo de FLACSO Uruguay',
  ];

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: ${FONT_STACK}; line-height: 1.6; color: #101828; background-color: #f1f5f9; margin: 0; padding: 24px 12px;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div style="background: #16396f; padding: 22px 32px;">
      <h2 style="color: #ffffff; margin: 0; font-size: 20px;">FLACSO Uruguay</h2>
    </div>
    <div style="padding: 28px 32px 32px;">
      <h1 style="color: #101828; font-size: 20px; margin: 0 0 16px 0;">Recibimos tu preinscripción</h1>
      <p style="margin: 0 0 12px 0;">Hola <strong>${escapeHtml(greetingName)}</strong>,</p>
      <p style="margin: 0 0 24px 0;">Hemos recibido tu postulación para <strong>${escapeHtml(snapshot.targetTitle)}</strong>.</p>
      <div style="background: #eff8ff; border-left: 4px solid #175cd3; border-radius: 4px; padding: 14px 16px; margin-bottom: 28px; font-size: 14px;">
        <strong>¿Qué sigue?</strong> Nos pondremos en contacto a la brevedad para coordinar los siguientes pasos del proceso de admisión.
      </div>
      <h2 style="font-size: 16px; margin: 0 0 16px 0; color: #101828;">Datos de tu postulación</h2>
      ${renderSectionsHtml(model)}
      <p style="color: #475467; font-size: 14px; margin: 24px 0 0 0;">Si algún dato es incorrecto, escribinos a <a href="mailto:${CONTACT_EMAIL}" style="color: #175cd3;">${CONTACT_EMAIL}</a>.</p>
      <hr style="border: none; border-top: 1px solid #eaecf0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #98a2b3; margin: 0;">FLACSO Uruguay · Programa Académico</p>
    </div>
  </div>
</body>
</html>`;

  return {
    audience: 'applicant',
    to: snapshot.applicantEmail,
    subject,
    text: textLines.join('\n'),
    html,
    tags: {
      audience: 'applicant',
      submissionId: snapshot.submissionId,
      targetId: snapshot.targetId,
    },
  };
}

export function renderOperationalNotification(
  snapshot: SubmissionNotificationSnapshot,
  audience: 'target' | 'master',
  to: string
): RenderedNotification {
  const applicantPrefix = snapshot.applicantName ? `${snapshot.applicantName} — ` : '';
  const subject = `[Preinscripción] ${applicantPrefix}${snapshot.targetTitle}`;
  const model = buildModel(snapshot);
  const summary = buildSummary(snapshot, model);

  const textLines: string[] = [
    `Nueva preinscripción registrada para ${snapshot.targetTitle}`,
    `ID de seguimiento: ${snapshot.submissionId}`,
    '',
    'RESUMEN',
    '--------------------------------------------------',
    ...summary.map((entry) => `${entry.label}: ${entry.text}`),
    '',
    'ACCESOS OPERATIVOS DIRECTOS',
    '--------------------------------------------------',
    `Planilla Google Sheets: ${snapshot.spreadsheetRowUrl}`,
    `Carpeta Google Drive: ${snapshot.documentsFolderUrl}`,
    '',
    ...renderSectionsText(model),
  ];

  const summaryHtml = summary
    .map(
      (entry) => `<tr>
          <td style="padding: 5px 12px 5px 0; color: #667085; font-size: 13px; vertical-align: top; overflow-wrap: anywhere;">${escapeHtml(entry.label)}</td>
          <td style="padding: 5px 0; color: #101828; font-size: 14px; vertical-align: top;">${entry.html}</td>
        </tr>`,
    )
    .join('');

  const buttons = [
    renderButton('Abrir planilla', snapshot.spreadsheetRowUrl, true),
    renderButton('Abrir documentación', snapshot.documentsFolderUrl, false),
  ].join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: ${FONT_STACK}; line-height: 1.55; color: #17253d; background-color: #edf2f8; margin: 0; padding: 24px 10px;">
  <div style="display:none; font-size:1px; color:#edf2f8; max-height:0; max-width:0; opacity:0; overflow:hidden;">Nueva preinscripción de ${escapeHtml(snapshot.applicantName || snapshot.applicantEmail)}. Accedé a la documentación y la planilla.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; max-width:660px; border-collapse:separate; border-spacing:0; background:#ffffff; border:1px solid #dce5f0; border-radius:12px; overflow:hidden;">
      <tr><td style="background:#123b70; padding:20px 24px; color:#ffffff;">
        <p style="font-size:18px; line-height:1.2; font-weight:700; margin:0; color:#ffffff;">FLACSO <span style="font-weight:400;">Uruguay</span></p>
        <p style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#d7e6f8; margin:6px 0 0;">Gestión de preinscripciones</p>
      </td></tr>
      <tr><td style="padding:28px 24px 10px;">
        <p style="font-size:11px; font-weight:700; letter-spacing:0.7px; color:#235b98; margin:0 0 10px; text-transform:uppercase;">Nueva postulación recibida</p>
        <h1 style="font-size:23px; line-height:1.3; font-weight:700; margin:0 0 10px; color:#142b49;">${escapeHtml(snapshot.targetTitle)}</h1>
        <p style="font-size:12px; color:#65758a; margin:0 0 20px; overflow-wrap:anywhere;">Seguimiento: ${escapeHtml(snapshot.submissionId)}</p>
        <div style="background:#f4f7fb; border:1px solid #e2eaf4; border-radius:9px; padding:16px 14px;">
          <p style="margin:0 0 10px; color:#142b49; font-size:14px; font-weight:700;">Resumen de la postulación</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; table-layout:fixed;"><tbody>${summaryHtml}</tbody></table>
        </div>
      </td></tr>
      <tr><td style="padding:14px 24px 4px;">
        <p style="font-size:12px; color:#65758a; margin:0 0 10px;">Accesos para gestión interna</p>
        ${buttons}
      </td></tr>
      <tr><td style="padding:12px 24px 22px;">
        ${renderSectionsHtml(model)}
      </td></tr>
      <tr><td style="background:#f4f7fb; border-top:1px solid #e2eaf4; padding:16px 24px;">
        <p style="font-size:12px; color:#63748a; margin:0;">FLACSO Uruguay · Notificación automática para gestión interna</p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;

  return {
    audience,
    to,
    subject,
    text: textLines.join('\n'),
    html,
    tags: {
      audience,
      submissionId: snapshot.submissionId,
      targetId: snapshot.targetId,
    },
  };
}

export function renderAllNotifications(
  snapshot: SubmissionNotificationSnapshot,
  masterEmails: string[]
): RenderedNotification[] {
  const notifications: RenderedNotification[] = [];

  // 1. Applicant notification
  notifications.push(renderApplicantNotification(snapshot));

  // 2. Target notifications (one per configured offer email)
  const seenEmails = new Set<string>();
  for (const rawTarget of snapshot.notificationEmails ?? []) {
    const targetEmail = rawTarget.toLowerCase().trim();
    if (targetEmail && !seenEmails.has(targetEmail)) {
      seenEmails.add(targetEmail);
      notifications.push(renderOperationalNotification(snapshot, 'target', targetEmail));
    }
  }

  // 3. Master notifications (deduplicated against target emails and each other)

  for (const rawMaster of masterEmails) {
    const masterEmail = rawMaster.toLowerCase().trim();
    if (masterEmail && !seenEmails.has(masterEmail)) {
      seenEmails.add(masterEmail);
      notifications.push(renderOperationalNotification(snapshot, 'master', masterEmail));
    }
  }

  return notifications;
}
