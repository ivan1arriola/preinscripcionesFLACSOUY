import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SubmissionRepository } from '../ports/submission-repository.js';
import { getCanonicalFormDefinition, CANONICAL_SCHEMA_VERSION } from '../domain/canonical-forms.js';
import { validateSubmission } from '../domain/form-validation.js';
import { normalizeIdentityValues } from '../domain/identity-validation.js';
import { normalizePermalink, resolveSeminarPermalinks } from '../domain/seminar-permalink-availability.js';
import { driveTargetDescriptor } from '../domain/google-drive-naming.js';
import type { AcademicTarget, FormDefinition, SubmissionFileToken } from '@flacso/contracts';
import { buildSpreadsheetSchema, buildSpreadsheetValues } from '../domain/spreadsheet-schema.js';

/** Antigüedad máxima del catálogo guardado para aceptar preinscripciones con WordPress caído. */
export const CACHED_CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type CatalogValidation = 'live' | 'cached';

export interface SubmitPreinscriptionCommand {
  clientSubmissionId?: string;
  targetId: string;
  configRevision: string;
  values: Record<string, string>;
  files?: SubmissionFileToken[];
}

export type SubmitPreinscriptionResult =
  | {
      ok: true;
      submissionId: string;
      spreadsheet: {
        valuesByColumnName: Record<string, string>;
        requiredColumns: string[];
      };
      driveTarget: ReturnType<typeof driveTargetDescriptor>;
      target: AcademicTarget;
      form: FormDefinition;
      normalizedValues: Record<string, string>;
      catalogValidation: CatalogValidation;
    }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'CLOSED' | 'INCOMPATIBLE_FORM' | 'STALE_REVISION' | 'VALIDATION_ERROR' | 'CATALOG_UNAVAILABLE';
      message: string;
      fieldErrors?: Record<string, string[]>;
      issues?: string[];
    };

export async function submitPreinscription(
  catalog: AcademicCatalog,
  repository: SubmissionRepository,
  command: SubmitPreinscriptionCommand = {} as SubmitPreinscriptionCommand,
): Promise<SubmitPreinscriptionResult> {
  // 1. Re-query and revalidate the academic catalog during submission.
  // Si WordPress no responde, se valida contra el catálogo guardado (acotado en antigüedad)
  // para no perder el formulario y los documentos que el postulante ya completó.
  const resolved = await resolveCatalogForSubmission(catalog);
  if (!resolved) {
    return {
      ok: false,
      code: 'CATALOG_UNAVAILABLE',
      message: 'No pudimos verificar la convocatoria en este momento. Sus datos no se perdieron: intente enviar nuevamente en unos minutos.',
    };
  }
  const { targets: catalogTargets, catalogValidation } = resolved;
  const target = catalogTargets.find((t) => t.id === command.targetId) ?? null;

  if (!target) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `No se encontró el destino académico con ID "${command.targetId}".`,
    };
  }

  // 2. Closed target rejection
  if (!target.registrationOpen) {
    return {
      ok: false,
      code: 'CLOSED',
      message: 'La preinscripción para este destino académico se encuentra cerrada.',
    };
  }

  if (target.kind === 'seminar') {
    const resolutions = resolveSeminarPermalinks(catalogTargets);
    const rawUrl = target.urls?.legacyRegistration;
    const permalink = rawUrl && rawUrl.trim() ? normalizePermalink(rawUrl) : null;
    const resolution = permalink ? resolutions.get(permalink) : undefined;

    if (resolution) {
      if (resolution.status === 'conflict' || resolution.status === 'closed' || resolution.targetId !== target.id) {
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
  }

  // 3. Compose canonical form
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

  const form = composition.value;

  // 4. Normalize identity values & validate
  const normalizedValues = normalizeIdentityValues(command.values);
  const validation = validateSubmission(form, normalizedValues, command.configRevision, command.files);
  if (!validation.valid) {
    if (validation.fieldErrors._form) {
      return {
        ok: false,
        code: 'STALE_REVISION',
        message: validation.fieldErrors._form[0] ?? 'Revisión de formulario obsoleta.',
        fieldErrors: validation.fieldErrors,
      };
    }

    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Existen errores de validación en los campos enviados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  // 5. Persist submission
  const saved = await repository.saveOrGet({
    clientSubmissionId: command.clientSubmissionId,
    targetId: target.id,
    configRevision: form.effectiveRevision,
    targetTitle: target.title,
    targetKind: target.kind,
    values: normalizedValues,
    files: command.files,
    profileVersionId: CANONICAL_SCHEMA_VERSION,
    profileSnapshot: form as any,
    catalogValidation,
  });

  const spreadsheetSchema = buildSpreadsheetSchema(form);

  return {
    ok: true,
    submissionId: saved.id,
    spreadsheet: {
      valuesByColumnName: buildSpreadsheetValues(form, normalizedValues, saved.id),
      requiredColumns: spreadsheetSchema.requiredColumns,
    },
    driveTarget: driveTargetDescriptor(target),
    target,
    form,
    normalizedValues,
    catalogValidation,
  };
}

async function resolveCatalogForSubmission(
  catalog: AcademicCatalog,
): Promise<{ targets: AcademicTarget[]; catalogValidation: CatalogValidation } | null> {
  try {
    return { targets: await catalog.revalidateTargets(), catalogValidation: 'live' };
  } catch (error) {
    const cached = catalog.listCachedTargets
      ? await catalog.listCachedTargets(CACHED_CATALOG_MAX_AGE_MS)
      : null;
    console.warn(
      `[Catalog] WordPress no respondió al validar una preinscripción; ${cached ? 'se usa el catálogo guardado' : 'no hay catálogo guardado reciente'}:`,
      error instanceof Error ? error.message : error,
    );
    return cached ? { targets: cached, catalogValidation: 'cached' } : null;
  }
}
