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

function escapeHtml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderApplicantNotification(
  snapshot: SubmissionNotificationSnapshot
): RenderedNotification {
  const subject = `Confirmación de preinscripción — ${snapshot.targetTitle}`;

  const greetingName = snapshot.applicantName || 'Estimado/a postulante';

  const textLines: string[] = [
    `Hola ${greetingName},`,
    '',
    `Hemos recibido correctamente tu solicitud de preinscripción para:`,
    `${snapshot.targetTitle}`,
    '',
    'A continuación detallamos los datos registrados:',
    '--------------------------------------------------',
  ];

  const orderedKeys = snapshot.orderedFieldKeys?.length
    ? snapshot.orderedFieldKeys
    : Object.keys(snapshot.values);

  for (const key of orderedKeys) {
    const item = snapshot.values[key];
    if (item) {
      textLines.push(`${item.label}: ${item.value}`);
    }
  }

  textLines.push(
    '--------------------------------------------------',
    '',
    'Nos pondremos en contacto a la brevedad con los siguientes pasos del proceso de admisión.',
    '',
    'Saludos cordiales,',
    'Equipo de FLACSO Uruguay'
  );

  const htmlDataRows = orderedKeys
    .map((key) => {
      const item = snapshot.values[key];
      if (!item) return '';
      return `<tr>
        <td style="padding: 8px 12px; font-weight: 600; color: #475467; border-bottom: 1px solid #eaecf0; width: 35%;">${escapeHtml(
          item.label
        )}</td>
        <td style="padding: 8px 12px; color: #101828; border-bottom: 1px solid #eaecf0;">${escapeHtml(
          item.value
        )}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #101828; background-color: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="margin-bottom: 24px;">
      <h2 style="color: #175cd3; margin: 0 0 8px 0; font-size: 20px;">FLACSO Uruguay</h2>
      <h1 style="color: #101828; font-size: 18px; margin: 0;">Confirmación de preinscripción recibida</h1>
    </div>
    <p style="margin-bottom: 16px;">Hola <strong>${escapeHtml(greetingName)}</strong>,</p>
    <p style="margin-bottom: 20px;">Hemos recibido tu postulación para <strong>${escapeHtml(
      snapshot.targetTitle
    )}</strong>.</p>
    <div style="margin-bottom: 24px;">
      <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 12px;">Datos de tu postulación</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tbody>
          ${htmlDataRows}
        </tbody>
      </table>
    </div>
    <p style="color: #475467; font-size: 14px; margin-top: 24px;">Nos pondremos en contacto a la brevedad para coordinar los siguientes pasos.</p>
    <hr style="border: none; border-top: 1px solid #eaecf0; margin: 24px 0;" />
    <p style="font-size: 12px; color: #98a2b3; margin: 0;">FLACSO Uruguay · Programa Académico</p>
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

  const textLines: string[] = [
    `Nueva preinscripción registrada para ${snapshot.targetTitle}`,
    '',
    `Postulante: ${snapshot.applicantName || snapshot.applicantEmail}`,
    `Email: ${snapshot.applicantEmail}`,
    `ID de seguimiento: ${snapshot.submissionId}`,
    '',
    'ACCESOS OPERATIVOS DIRECTOS:',
    `Planilla Google Sheets: ${snapshot.spreadsheetRowUrl}`,
    `Carpeta Google Drive: ${snapshot.documentsFolderUrl}`,
    '',
    'DATOS COMPLETOS DEL FORMULARIO:',
    '--------------------------------------------------',
  ];

  const orderedKeys = snapshot.orderedFieldKeys?.length
    ? snapshot.orderedFieldKeys
    : Object.keys(snapshot.values);

  for (const key of orderedKeys) {
    const item = snapshot.values[key];
    if (item) {
      textLines.push(`${item.label}: ${item.value}`);
    }
  }

  textLines.push('--------------------------------------------------');

  const htmlDataRows = orderedKeys
    .map((key) => {
      const item = snapshot.values[key];
      if (!item) return '';
      return `<tr>
        <td style="padding: 8px 12px; font-weight: 600; color: #475467; border-bottom: 1px solid #eaecf0; width: 35%;">${escapeHtml(
          item.label
        )}</td>
        <td style="padding: 8px 12px; color: #101828; border-bottom: 1px solid #eaecf0;">${escapeHtml(
          item.value
        )}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #101828; background-color: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="margin-bottom: 24px;">
      <span style="background: #eff8ff; color: #175cd3; font-size: 12px; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-transform: uppercase;">Notificación Operativa</span>
      <h1 style="color: #101828; font-size: 20px; margin: 12px 0 4px 0;">${escapeHtml(
        snapshot.targetTitle
      )}</h1>
      <p style="color: #475467; margin: 0;">Nueva postulación recibida</p>
      <p style="color: #475467; margin: 4px 0 0;">ID de seguimiento: ${escapeHtml(snapshot.submissionId)}</p>
    </div>

    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 12px 0; font-size: 14px; text-transform: uppercase; color: #475467;">Enlaces directos de gestión</h3>
      <div style="margin-bottom: 8px;">
        📊 <strong>Planilla:</strong> <a href="${escapeHtml(
          snapshot.spreadsheetRowUrl
        )}" target="_blank" style="color: #175cd3; text-decoration: underline;">${escapeHtml(
    snapshot.spreadsheetRowUrl
  )}</a>
      </div>
      <div>
        📁 <strong>Documentación (Drive):</strong> <a href="${escapeHtml(
          snapshot.documentsFolderUrl
        )}" target="_blank" style="color: #175cd3; text-decoration: underline;">${escapeHtml(
    snapshot.documentsFolderUrl
  )}</a>
      </div>
    </div>

    <div>
      <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 12px;">Datos ingresados por el postulante</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tbody>
          ${htmlDataRows}
        </tbody>
      </table>
    </div>
  </div>
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
