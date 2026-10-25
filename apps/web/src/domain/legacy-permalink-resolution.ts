import type { DiagnosticTarget } from '@flacso/contracts';

export const HOME_PATH = '/';

export const normalizePath = (path: string): string => {
  if (!path || path === HOME_PATH) return HOME_PATH;
  let normalized = path.trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  normalized = normalized.endsWith('/') ? normalized : `${normalized}/`;
  return normalized
    .replace(/^\/ofertas\/([^/]+)\/$/i, '/oferta/$1/')
    .replace(/^\/seminarios\/([^/]+)\/$/i, '/seminario/$1/');
};

export const legacyPathForTarget = (target: DiagnosticTarget): string | null => {
  const legacyRegistration = target.urls?.legacyRegistration;
  if (!legacyRegistration) return null;

  try {
    const pathname = legacyRegistration.startsWith('http://') || legacyRegistration.startsWith('https://')
      ? new URL(legacyRegistration).pathname
      : legacyRegistration;
    const path = normalizePath(pathname);
    return /^\/(oferta|seminario)\/[^/]+\/$/.test(path) ? path : null;
  } catch {
    return null;
  }
};

export type LegacyPermalinkResult =
  | { kind: 'target'; target: DiagnosticTarget }
  | { kind: 'closed'; title?: string }
  | { kind: 'conflict'; title?: string }
  | { kind: 'not_found' };

export function resolveLegacyPermalink(
  targets: DiagnosticTarget[],
  path: string
): LegacyPermalinkResult {
  const normalizedPath = normalizePath(path);
  if (!/^\/(oferta|seminario)\/[^/]+\/$/.test(normalizedPath)) {
    return { kind: 'not_found' };
  }

  const matchingTargets = targets.filter(
    (t) => legacyPathForTarget(t) === normalizedPath
  );

  if (matchingTargets.length === 0) {
    return { kind: 'not_found' };
  }

  // Misma regla para /oferta/ y /seminario/: el enlace lleva a su único destino abierto.
  // La API ya resolvió disponibilidad y conflictos por enlace; acá sólo se lee ese resultado.
  const title = matchingTargets[0]?.title;

  const hasConflict = matchingTargets.some(
    (t) =>
      t.registrationAvailability === 'conflict' ||
      t.issues.includes('multiple_open_seminar_editions') ||
      t.issues.includes('multiple_open_cohorts') ||
      t.issues.includes('inconsistent_seminar_permalink')
  );
  if (hasConflict) {
    return { kind: 'conflict', title };
  }

  const openTargets = matchingTargets.filter((t) => {
    if (t.registrationAvailability !== undefined) {
      return t.registrationAvailability === 'open';
    }
    return Boolean(t.registrationOpen && t.status === 'operational');
  });

  if (openTargets.length === 1 && openTargets[0]) {
    return { kind: 'target', target: openTargets[0] };
  }

  if (openTargets.length > 1) {
    return { kind: 'conflict', title };
  }

  return { kind: 'closed', title };
}
