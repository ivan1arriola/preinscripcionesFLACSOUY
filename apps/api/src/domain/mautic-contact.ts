import type { AcademicTarget } from '@flacso/contracts';

/**
 * Contacto del postulante para Mautic. Sólo perfil estable y tags: los datos de
 * cada preinscripción (documento, nacimiento, estudios, archivos) no salen del
 * sistema. Sin consentimiento comercial explícito no se inscribe en campañas.
 */
export interface MauticContactSync {
  email: string;
  fields: Record<string, string>;
  tags: string[];
}

/** Mismo slug que FLACSO_Inquiry_Tag_Factory::slug del plugin (los tags deben coincidir). */
export function mauticSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[áÁ]/g, 'a')
    .replace(/[éÉ]/g, 'e')
    .replace(/[íÍ]/g, 'i')
    .replace(/[óÓ]/g, 'o')
    .replace(/[úÚüÜ]/g, 'u')
    .replace(/[ñÑ]/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Código del destino, igual que las consultas del plugin: la abreviación de la
 * oferta, o el nombre del seminario.
 */
export function mauticTargetCode(target: AcademicTarget): string {
  if (target.kind === 'seminar') {
    return mauticSlug(target.seminar?.name ?? '');
  }
  return mauticSlug(target.offer?.abbreviation || target.offer?.slug || '');
}

export function buildMauticContactTags(target: AcademicTarget): string[] {
  const code = mauticTargetCode(target);
  const tags: string[] = [];
  if (code) {
    tags.push(`preinscripcion-${code}`);
    const number = Number(target.kind === 'seminar' ? target.edition?.number : target.cohort?.number);
    if (Number.isInteger(number) && number > 0) {
      tags.push(`${code}-${target.kind === 'seminar' ? 'e' : 'c'}${number}`);
    }
  }
  tags.push('origen-preinscripciones');
  return tags;
}

function joinNames(...parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim() ?? '').filter(Boolean).join(' ');
}

export function buildMauticContactSync(
  target: AcademicTarget,
  values: Record<string, string>,
): MauticContactSync | null {
  const email = values.email?.trim().toLowerCase();
  if (!email) return null;

  const fields: Record<string, string> = {
    firstname: joinNames(values.nombre1, values.nombre2),
    lastname: joinNames(values.apellido1, values.apellido2),
    flacso_origen: 'preinscripciones',
    flacso_pais: values.paisResidencia?.trim() ?? '',
    flacso_profesion: values.ocupacion?.trim() ?? '',
  };
  // No pisar con vacío datos que Mautic ya tenga.
  for (const key of Object.keys(fields)) {
    if (!fields[key]) delete fields[key];
  }

  return { email, fields, tags: buildMauticContactTags(target) };
}
