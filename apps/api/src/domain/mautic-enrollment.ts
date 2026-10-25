import crypto from 'node:crypto';
import type { AcademicTarget } from '@flacso/contracts';

/**
 * Aviso de inscripción para el plugin FLACSO de Mautic (POST /flacso/enrollments).
 * Saca al postulante de la campaña de seguimiento de esa oferta.
 *
 * Sólo reduce comunicaciones: Mautic nunca crea contactos con él. Por eso se
 * envía aunque el postulante no haya aceptado comunicaciones.
 */
export interface MauticEnrollmentNotice {
  email: string;
  offerWpId: number;
}

export function buildMauticEnrollmentNotice(
  target: AcademicTarget,
  values: Record<string, string>,
): MauticEnrollmentNotice | null {
  // Las campañas de seguimiento existen sólo para ofertas académicas.
  if (target.kind !== 'academic_offer') return null;
  const offerWpId = Number(target.offer?.id);
  const email = values.email?.trim().toLowerCase();
  if (!Number.isInteger(offerWpId) || offerWpId <= 0 || !email) return null;
  return { email, offerWpId };
}

/** Mismo formato que WebhookSignature::sign() del plugin: "sha256=" + HMAC(secreto, timestamp + "." + cuerpo). */
export function signMauticEnrollment(secret: string, timestamp: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
