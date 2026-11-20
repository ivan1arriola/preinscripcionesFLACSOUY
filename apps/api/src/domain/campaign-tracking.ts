import type { AcademicTarget } from '@flacso/contracts';
import { joinNames } from './mautic-contact.js';

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'fbclid'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

/** Único dato que se guarda para el análisis de campañas (tabla campaign_tracking). */
export interface CampaignTrackingRecord {
  nombre: string;
  apellido: string;
  correo: string;
  oferta: string;
  ofertaTipo: string;
  edicion: string | null;
  pais: string | null;
  utm: Record<UtmKey, string | null>;
}

export interface CampaignTrackingRow extends CampaignTrackingRecord {
  id: string;
  submissionId: string;
  createdAt: Date;
}

function nameOrNumber(value?: { name?: string; number?: number | string }): string | null {
  const text = value?.name?.trim() || (value?.number !== undefined ? String(value.number).trim() : '');
  return text || null;
}

export function buildCampaignTracking(
  target: AcademicTarget,
  values: Record<string, string>,
  utm: Record<string, string | undefined> = {},
): CampaignTrackingRecord {
  return {
    nombre: joinNames(values.nombre1, values.nombre2),
    apellido: joinNames(values.apellido1, values.apellido2),
    correo: (values.email ?? '').trim().toLowerCase(),
    oferta: target.offer?.name ?? target.seminar?.name ?? target.title,
    ofertaTipo: target.kind,
    edicion: nameOrNumber(target.kind === 'seminar' ? target.edition : target.cohort),
    pais: values.paisResidencia?.trim() || null,
    utm: Object.fromEntries(UTM_KEYS.map((key) => [key, utm[key]?.trim() || null])) as Record<UtmKey, string | null>,
  };
}

export const CAMPAIGN_TRACKING_MAX_ROWS = 100_000;

/** Inicio (00:00 en Montevideo) de un día YYYY-MM-DD. shortcut: Uruguay no usa horario de verano desde 2015 (UTC-3 fijo); revisar si vuelve. */
export function montevideoDayStart(day: string): Date {
  return new Date(`${day}T00:00:00-03:00`);
}

/** `to` es el inicio del último día incluido; el filtro es exclusivo en el inicio del día siguiente. */
export function nextMontevideoMidnight(to: Date): Date {
  return new Date(to.getTime() + 24 * 60 * 60 * 1000);
}
