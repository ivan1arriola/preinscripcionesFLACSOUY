import type { FormDefinition } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import { getCanonicalFormDefinition } from '../domain/canonical-forms.js';
import { normalizePermalink, resolvePermalinks } from '../domain/permalink-availability.js';

export type GetTargetFormResult =
  | { ok: true; form: FormDefinition }
  | { ok: false; code: 'NOT_FOUND' | 'INCOMPATIBLE_FORM' | 'CLOSED'; message: string; issues?: string[] };

export async function getTargetForm(
  catalog: AcademicCatalog,
  targetId: string = '',
): Promise<GetTargetFormResult> {
  let target = await catalog.getTarget(targetId);

  if (!target) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `No se encontró el destino académico con ID "${targetId}".`,
    };
  }

  if (!target.registrationOpen) {
    return {
      ok: false,
      code: 'CLOSED',
      message: 'La preinscripción para este destino académico se encuentra cerrada.',
    };
  }

  // Cohortes y ediciones: el enlace de preinscripción debe resolver a este destino.
  let allTargets;
  try {
    allTargets = await catalog.revalidateTargets();
  } catch (error) {
    console.warn(
      '[Catalog] Revalidación no disponible; usando catálogo cacheado:',
      error instanceof Error ? error.message : error,
    );
    allTargets = await catalog.listTargets();
  }
  // El destino leído al inicio puede venir de la caché: se compone el formulario con el revalidado.
  const initialTargetId = target.id;
  const refreshed = allTargets.find((candidate) => candidate.id === initialTargetId);
  if (!refreshed) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `No se encontró el destino académico con ID "${targetId}".`,
    };
  }
  target = refreshed;
  if (!target.registrationOpen) {
    return {
      ok: false,
      code: 'CLOSED',
      message: 'La preinscripción para este destino académico se encuentra cerrada.',
    };
  }
  const resolutions = resolvePermalinks(allTargets);
  const rawUrl = target.urls?.legacyRegistration;
  const permalink = rawUrl && rawUrl.trim() ? normalizePermalink(rawUrl) : null;
  const resolution = permalink ? resolutions.get(permalink) : undefined;

  if (resolution) {
    if (resolution.status === 'conflict') {
      return {
        ok: false,
        code: 'CLOSED',
        message: 'La preinscripción para este seminario presenta un conflicto en el catálogo.',
      };
    }
    if (resolution.status === 'closed' || resolution.targetId !== target.id) {
      return {
        ok: false,
        code: 'CLOSED',
        message: 'La preinscripción para este destino académico se encuentra cerrada.',
      };
    }
  } else if (target.registrationAvailability === 'conflict' || target.registrationAvailability === 'closed') {
    return {
      ok: false,
      code: 'CLOSED',
      message: 'La preinscripción para este destino académico se encuentra cerrada.',
    };
  }

  const agreements = catalog.listAgreements
    ? await catalog.listAgreements()
    : [];

  const composition = getCanonicalFormDefinition(target, agreements);
  if (!composition.ok) {
    return {
      ok: false,
      code: 'INCOMPATIBLE_FORM',
      message: composition.error.message,
      issues: composition.error.issues,
    };
  }

  return {
    ok: true,
    form: composition.value,
  };
}
