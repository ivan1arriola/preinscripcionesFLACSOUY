import type { EmailNotificationRepository } from '../ports/email-notification-repository.js';

export const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;

/** Días que se conserva la copia de los datos del postulante en las notificaciones enviadas. */
export function getNotificationRetentionDays(): number {
  const configured = Number(process.env.NOTIFICATION_PAYLOAD_RETENTION_DAYS);
  return Number.isInteger(configured) && configured >= 1 ? configured : DEFAULT_NOTIFICATION_RETENTION_DAYS;
}

export interface PurgeNotificationPersonalDataInput {
  repository: Pick<EmailNotificationRepository, 'redactSentBefore'>;
  retentionDays?: number;
  now?: Date;
  batchSize?: number;
}

/**
 * Política de retención: una notificación ya enviada conserva su estado y fecha, pero pasados los días de
 * retención se elimina la copia de los datos del postulante que guarda su contenido.
 */
export async function purgeNotificationPersonalData(input: PurgeNotificationPersonalDataInput): Promise<number> {
  if (!input.repository.redactSentBefore) return 0;
  const retentionDays = input.retentionDays ?? getNotificationRetentionDays();
  const cutoff = new Date((input.now ?? new Date()).getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return input.repository.redactSentBefore(cutoff, input.batchSize ?? 500);
}
