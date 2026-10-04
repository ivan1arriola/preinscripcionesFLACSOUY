import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SubmissionRepository } from '../ports/submission-repository.js';
import type { FormProfileRepository } from '../ports/form-profile-repository.js';
import { getCanonicalFormDefinition, CANONICAL_SCHEMA_VERSION } from '../domain/canonical-forms.js';
import { validateSubmission } from '../domain/form-validation.js';
import { normalizeIdentityValues } from '../domain/identity-validation.js';
import { normalizePermalink, resolveSeminarPermalinks } from '../domain/seminar-permalink-availability.js';
import { driveTargetDescriptor } from '../domain/google-drive-naming.js';
import type { SubmissionFileToken } from '@flacso/contracts';

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
    }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'CLOSED' | 'INCOMPATIBLE_FORM' | 'STALE_REVISION' | 'VALIDATION_ERROR';
      message: string;
      fieldErrors?: Record<string, string[]>;
      issues?: string[];
    };

export async function submitPreinscription(
  catalog: AcademicCatalog,
  repository: SubmissionRepository,
  _profileRepository?: FormProfileRepository,
  command: SubmitPreinscriptionCommand = {} as SubmitPreinscriptionCommand
): Promise<SubmitPreinscriptionResult> {
  // 1. Re-query and revalidate the academic catalog during submission
  const target = await catalog.revalidateTarget(command.targetId);

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
    const allTargets = await catalog.revalidateTargets();
    const resolutions = resolveSeminarPermalinks(allTargets);
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
  });

  return {
    ok: true,
    submissionId: saved.id,
    spreadsheet: {
      valuesByColumnName: Object.fromEntries(
        form.inputs.map((input) => [
          input.spreadsheetColumn ?? input.label,
          normalizedValues[input.key] ?? '',
        ]),
      ),
      requiredColumns: form.inputs
        .filter((input) => input.required)
        .map((input) => input.spreadsheetColumn ?? input.label),
    },
    driveTarget: driveTargetDescriptor(target),
  };
}
