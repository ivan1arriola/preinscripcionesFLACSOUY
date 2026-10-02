import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SubmissionRepository } from '../ports/submission-repository.js';
import type { FormProfileRepository } from '../ports/form-profile-repository.js';
import { composeForm } from '../domain/form-composition.js';
import { isSupportedOfferType } from '../domain/form-profiles.js';
import { validateSubmission } from '../domain/form-validation.js';
import { normalizeIdentityValues } from '../domain/identity-validation.js';
import type { SubmissionFileToken } from '@flacso/contracts';

export interface SubmitPreinscriptionCommand {
  targetId: string;
  configRevision: string;
  values: Record<string, string>;
  files?: SubmissionFileToken[];
}

export type SubmitPreinscriptionResult =
  | { ok: true; submissionId: string }
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
  profileRepository: FormProfileRepository,
  command: SubmitPreinscriptionCommand
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

  // 3. Compose form
  const offerType = target.kind === 'seminar'
    ? 'seminar'
    : target.offer?.type || target.offerType || '';
  const activeProfile = isSupportedOfferType(offerType)
    ? await profileRepository.getActive(offerType)
    : null;
  const composition = composeForm(target, activeProfile);
  if (!composition.ok) {
    return {
      ok: false,
      code: 'INCOMPATIBLE_FORM',
      message: composition.error.message,
      issues: composition.error.issues,
    };
  }

  const form = composition.value;

  // 4. Validate values & revision
  const validation = validateSubmission(form, command.values, command.configRevision);
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

  const providedFileFields = new Set((command.files ?? []).map((file) => file.fieldKey));
  for (const document of form.documents ?? []) {
    if (document.required && !providedFileFields.has(document.key) && !document.canDefer) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Faltan documentos obligatorios para completar la preinscripción.',
        fieldErrors: { [document.key]: [`El documento ${document.label} es obligatorio.`] },
      };
    }
  }

  // 5. Persist submission
  const normalizedValues = normalizeIdentityValues(command.values);
  const saved = await repository.save({
    targetId: target.id,
    configRevision: form.effectiveRevision,
    targetTitle: target.title,
    targetKind: target.kind,
    values: normalizedValues,
    files: command.files,
    profileVersionId: form.profileVersionId ?? null,
    profileSnapshot: activeProfile?.definition ?? null,
  });

  return {
    ok: true,
    submissionId: saved.id,
  };
}
