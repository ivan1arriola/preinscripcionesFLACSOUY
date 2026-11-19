import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SubmissionRepository } from '../ports/submission-repository.js';
import { getCanonicalFormDefinition, CANONICAL_SCHEMA_VERSION } from '../domain/canonical-forms.js';
import { validateSubmission } from '../domain/form-validation.js';
import { normalizeIdentityValues } from '../domain/identity-validation.js';
import { normalizePermalink, resolvePermalinks } from '../domain/permalink-availability.js';
import { driveTargetDescriptor } from '../domain/google-drive-naming.js';
import type { AcademicTarget, FormDefinition, SubmissionFileToken } from '@flacso/contracts';
import { buildSpreadsheetSchema, buildSpreadsheetValues } from '../domain/spreadsheet-schema.js';
import { buildMauticContactSync } from '../domain/mautic-contact.js';
import { buildMauticEnrollmentNotice } from '../domain/mautic-enrollment.js';

/** Antigüedad máxima del catálogo guardado para aceptar preinscripciones con WordPress caído. */
export const CACHED_CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type CatalogValidation = 'live' | 'cached';

export interface SubmitPreinscriptionOptions {
  /** Si devuelve true, se encola la sincronización del contacto del postulante con Mautic. */
  isMauticContactSyncEnabled?: () => Promise<boolean>;
  /** Si devuelve true, se encola el aviso de inscripción a Mautic (con o sin aceptación de comunicaciones). */
  isMauticEnrollmentNotifyEnabled?: () => Promise<boolean>;
  /**
   * Se ejecuta tras validar y justo antes de guardar una preinscripción nueva (p. ej. fijar los archivos).
   * Si lanza, no se guarda nada y el error llega a quien llamó.
   */
  beforeSave?: () => Promise<void>;
}

/** Una configuración ilegible nunca bloquea la preinscripción: sólo omite el efecto en Mautic. */
async function isEnabled(check: (() => Promise<boolean>) | undefined, label: string): Promise<boolean> {
  try {
    return (await check?.()) === true;
  } catch (error) {
    console.warn(`[Mautic] No se pudo leer la configuración de ${label}; se omite:`, error instanceof Error ? error.message : error);
    return false;
  }
}

export interface SubmitPreinscriptionCommand {
  clientSubmissionId?: string;
  targetId: string;
  configRevision: string;
  values: Record<string, string>;
  files?: SubmissionFileToken[];
  utm?: Record<string, string>;
}

export type SubmitPreinscriptionResult =
  | {
      ok: true;
      submissionId: string;
      /** true cuando el clientSubmissionId ya existía: los efectos (Drive, planilla, avisos) ya se ejecutaron. */
      existing: boolean;
      /** Dueño del lease del envío nuevo; quien procesa debe renovarlo mientras trabaja. */
      leaseOwner?: string;
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
  options: SubmitPreinscriptionOptions = {},
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

  // Cohortes y ediciones: el enlace de preinscripción debe resolver a este destino.
  const resolutions = resolvePermalinks(catalogTargets);
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
  // Sólo se conservan las claves que el formulario define: el resto se descarta para que un envío manual
  // no pueda crear definiciones de campos ni filas arbitrarias en la base.
  const allowedKeys = new Set(form.inputs.map((input) => input.key));
  const normalizedValues = Object.fromEntries(
    Object.entries(normalizeIdentityValues(command.values)).filter(([key]) => allowedKeys.has(key)),
  );
  // Omitir `files` equivale a no adjuntar nada: los documentos obligatorios se exigen igual.
  const validation = validateSubmission(form, normalizedValues, command.configRevision, command.files ?? []);
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

  // 5. Persist submission (and, if enabled, enqueue the Mautic contact sync and enrollment notice atomically)
  const mauticContact = (await isEnabled(options.isMauticContactSyncEnabled, 'contactos'))
    ? buildMauticContactSync(target, normalizedValues)
    : null;
  const mauticEnrollment = (await isEnabled(options.isMauticEnrollmentNotifyEnabled, 'avisos de inscripción'))
    ? buildMauticEnrollmentNotice(target, normalizedValues)
    : null;
  await options.beforeSave?.();
  const saved = await repository.saveOrGet({
    clientSubmissionId: command.clientSubmissionId,
    targetId: target.id,
    configRevision: form.effectiveRevision,
    targetTitle: target.title,
    targetKind: target.kind,
    values: normalizedValues,
    files: command.files,
    utm: command.utm,
    profileVersionId: CANONICAL_SCHEMA_VERSION,
    profileSnapshot: form as any,
    catalogValidation,
    mauticContact,
    mauticEnrollment,
  });

  const spreadsheetSchema = buildSpreadsheetSchema(form);

  return {
    ok: true,
    submissionId: saved.id,
    existing: saved.existing === true,
    leaseOwner: saved.leaseOwner,
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
