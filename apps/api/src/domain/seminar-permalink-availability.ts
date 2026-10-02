import type { AcademicTarget, RegistrationAvailability } from '@flacso/contracts';

export type SeminarPermalinkIssue = 'multiple_open_seminar_editions' | 'inconsistent_seminar_permalink';

export interface SeminarPermalinkResolution {
  status: RegistrationAvailability;
  targetId?: string;
  issue?: SeminarPermalinkIssue;
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
  return pathname.toLowerCase();
}

export function resolveSeminarPermalinks(targets: AcademicTarget[]): Map<string, SeminarPermalinkResolution> {
  const resolutions = new Map<string, SeminarPermalinkResolution>();
  const seminarTargets = targets.filter((t) => t.kind === 'seminar');

  // 1. Group by seminar identity to check permalink consistency across editions of the same seminar
  const seminarGroups = new Map<string, AcademicTarget[]>();
  for (const target of seminarTargets) {
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

  // 2. Group by normalized permalink for seminars that are not inconsistent
  const permalinkGroups = new Map<string, AcademicTarget[]>();
  for (const target of seminarTargets) {
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
  for (const [permalink, editions] of permalinkGroups.entries()) {
    const hasExplicitConflict = editions.some((e) => e.registrationAvailability === 'conflict');
    if (hasExplicitConflict) {
      resolutions.set(permalink, {
        status: 'conflict',
        issue: 'multiple_open_seminar_editions',
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
        issue: 'multiple_open_seminar_editions',
      });
    } else {
      resolutions.set(permalink, {
        status: 'closed',
      });
    }
  }

  return resolutions;
}
