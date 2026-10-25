import { EmailProviderError, type EmailMessage, type EmailProvider } from './email-provider.js';
import { MauticError, type MauticClient } from '../mautic/mautic-client.js';

export interface MauticEmailTemplates {
  /** Plantilla de Mautic para el correo al postulante. */
  applicantTemplateId: number;
  /** Plantilla de Mautic para los correos al equipo (oferta/seminario y maestros). */
  teamTemplateId: number;
}

/**
 * Tokens que deben existir en las plantillas de Mautic. La plantilla aporta el
 * diseño institucional; el contenido de cada preinscripción llega en los tokens.
 */
export const MAUTIC_NOTIFICATION_TOKENS = {
  subject: '{preinscripcion_asunto}',
  html: '{preinscripcion_contenido}',
  text: '{preinscripcion_texto}',
  submissionId: '{preinscripcion_id}',
} as const;

/**
 * Envía las notificaciones de preinscripción con plantillas de Mautic. Cada
 * destinatario debe existir como contacto: los del equipo se crean sin tags ni
 * campos; el contacto del postulante lo completa la sincronización de contactos.
 * Las plantillas no admiten Reply-To dinámico: el correo del postulante va en el cuerpo.
 */
export class MauticEmailProvider implements EmailProvider {
  constructor(
    private readonly client: MauticClient,
    private readonly templates: MauticEmailTemplates,
  ) {}

  async verify(): Promise<void> {
    await this.translateErrors(() => this.client.verify());
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const templateId = message.tags?.audience === 'applicant'
      ? this.templates.applicantTemplateId
      : this.templates.teamTemplateId;
    const tokens = {
      [MAUTIC_NOTIFICATION_TOKENS.subject]: message.subject,
      [MAUTIC_NOTIFICATION_TOKENS.html]: bodyContent(message.html),
      [MAUTIC_NOTIFICATION_TOKENS.text]: message.text,
      [MAUTIC_NOTIFICATION_TOKENS.submissionId]: message.tags?.submissionId ?? '',
    };

    const deliveries: string[] = [];
    for (const recipient of message.to) {
      await this.translateErrors(async () => {
        const contactId = await this.client.upsertContact(recipient);
        await this.client.sendTemplateEmail(templateId, contactId, tokens);
        deliveries.push(`mautic:${templateId}:${contactId}`);
      });
    }
    return { providerMessageId: deliveries.join(',') };
  }

  private async translateErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MauticError) {
        throw new EmailProviderError(error.message, error.classification);
      }
      throw new EmailProviderError('Error inesperado al enviar con Mautic.', 'unknown');
    }
  }
}

/** Contenido del <body> (las plantillas de Mautic ya aportan el documento HTML). */
function bodyContent(html: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return (match?.[1] ?? html).trim();
}
