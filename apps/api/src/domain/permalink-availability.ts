import type { AcademicTarget, RegistrationAvailability } from '@flacso/contracts';

export type PermalinkIssue = 'multiple_open_seminar_editions' | 'multiple_open_cohorts' | 'inconsistent_seminar_permalink';

export interface PermalinkResolution {
  status: RegistrationAvailability;
  targetId?: string;
  issue?: PermalinkIssue;
}

export function normalizePermalink(urlOrPath: string): string {
  if (!urlOrPath) return '';
  let pathname = urlOrPath.trim();
  if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      // Fallback to raw string if URL parsing fails
    }
  }
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }
  if (!pathname.endsWith('/')) {
    pathname = `${pathname}/`;
  }
  return pathname
    .toLowerCase()
    .replace(/^\/ofertas\/([^/]+)\/$/, '/oferta/$1/')
    .replace(/^\/seminarios\/([^/]+)\/$/, '/seminario/$1/');
}

function extractSeminarSlugFromPermalink(permalink: string): string | null {
  const match = /^\/seminario\/([^/]+)\/$/.exec(permalink);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

function isInheritedIntegratedComponent(target: AcademicTarget, allSeminarSlugs: Set<string>): boolean {
  if (target.kind !== 'seminar') return false;
  const ownSlug = target.seminar?.slug?.trim().toLowerCase();
  const rawUrl = target.urls?.legacyRegistration;
  if (!ownSlug || !rawUrl || !rawUrl.trim()) return false;
  const permalink = normalizePermalink(rawUrl);
  const permalinkSlug = extractSeminarSlugFromPermalink(permalink);
  if (!permalinkSlug || permalinkSlug === ownSlug) return false;
  return allSeminarSlugs.has(permalinkSlug);
}

/**
 * Un enlace de preinscripción (/oferta/… o /seminario/…) debe llevar a un único destino abierto.
 * Resuelve, por enlace, cuál destino está abierto o si hay conflicto. Es la única regla de
 * disponibilidad por enlace: la usan el catálogo público, el formulario y el envío.
 */
export function resolvePermalinks(targets: AcademicTarget[]): Map<string, PermalinkResolution> {
  const resolutions = new Map<string, PermalinkResolution>();
  const seminarTargets = targets.filter((t) => t.kind === 'seminar');
  const allSeminarSlugs = new Set<string>();
  for (const target of seminarTargets) {
    const slug = target.seminar?.slug?.trim().toLowerCase();
    if (slug) {
      allSeminarSlugs.add(slug);
    }
  }

  // 1. Group by seminar identity to check permalink consistency across editions of the same seminar
  const seminarGroups = new Map<string, AcademicTarget[]>();
  for (const target of seminarTargets) {
    if (isInheritedIntegratedComponent(target, allSeminarSlugs)) {
      continue;
    }
    const seminarKey = String(
      target.wordpress?.seminarId ??
      target.seminar?.id ??
      target.seminar?.slug ??
      target.title
    );
    const list = seminarGroups.get(seminarKey) ?? [];
    list.push(target);
    seminarGroups.set(seminarKey, list);
  }

  const inconsistentSeminars = new Set<string>();
  const inconsistentPermalinks = new Set<string>();

  for (const [seminarKey, editions] of seminarGroups.entries()) {
    const distinctPermalinks = new Set<string>();
    for (const edition of editions) {
      const rawUrl = edition.urls?.legacyRegistration;
      if (rawUrl && rawUrl.trim()) {
        distinctPermalinks.add(normalizePermalink(rawUrl));
      }
    }
    if (distinctPermalinks.size > 1) {
      inconsistentSeminars.add(seminarKey);
      for (const p of distinctPermalinks) {
        inconsistentPermalinks.add(p);
      }
    }
  }

  // Register conflicts for all inconsistent permalinks
  for (const permalink of inconsistentPermalinks) {
    resolutions.set(permalink, {
      status: 'conflict',
      issue: 'inconsistent_seminar_permalink',
    });
  }

  // 2. Group every target (cohorts and editions) by normalized permalink, skipping inconsistent seminars
  const permalinkGroups = new Map<string, AcademicTarget[]>();
  for (const target of targets) {
    const rawUrl = target.urls?.legacyRegistration;
    if (!rawUrl || !rawUrl.trim()) continue;

    const permalink = normalizePermalink(rawUrl);
    if (inconsistentPermalinks.has(permalink)) {
      continue;
    }

    const list = permalinkGroups.get(permalink) ?? [];
    list.push(target);
    permalinkGroups.set(permalink, list);
  }

  // 3. Resolve status for each permalink group
  for (const [permalink, rawEditions] of permalinkGroups.entries()) {
    // Si una edición componente heredó el link de un seminario integrado presente en el grupo,
    // la preinscripción corresponde únicamente al seminario integrado.
    const nativeEditions = rawEditions.filter((e) => !isInheritedIntegratedComponent(e, allSeminarSlugs));
    const editions = nativeEditions.length > 0 ? nativeEditions : rawEditions;

    const conflictIssue: PermalinkIssue = editions.some((e) => e.kind === 'seminar')
      ? 'multiple_open_seminar_editions'
      : 'multiple_open_cohorts';
    const hasExplicitConflict = editions.some((e) => e.registrationAvailability === 'conflict');
    if (hasExplicitConflict) {
      resolutions.set(permalink, {
        status: 'conflict',
        issue: conflictIssue,
      });
      continue;
    }

    const openEditions = editions.filter((e) => {
      if (e.registrationAvailability !== undefined) {
        return e.registrationAvailability === 'open';
      }
      return Boolean(e.registrationOpen);
    });

    if (openEditions.length === 1 && openEditions[0]) {
      resolutions.set(permalink, {
        status: 'open',
        targetId: openEditions[0].id,
      });
    } else if (openEditions.length > 1) {
      resolutions.set(permalink, {
        status: 'conflict',
        issue: conflictIssue,
      });
    } else {
      resolutions.set(permalink, {
        status: 'closed',
      });
    }
  }

  return resolutions;
}
