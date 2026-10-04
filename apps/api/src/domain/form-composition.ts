import crypto from 'node:crypto';
import type {
  AcademicTarget,
  FormDefinition,
  InputDefinition,
  DocumentDefinition,
  AgreementOption,
} from '@flacso/contracts';
import {
  UNIVERSAL_INPUTS,
  SUPPORTED_SPECIFIC_INPUTS,
  DOCUMENT_DEFINITIONS,
} from './form-definition.js';
import type { EffectiveProfile } from './form-profiles.js';

export type CompositionResult =
  | { ok: true; value: FormDefinition }
  | { ok: false; error: { code: string; message: string; issues: string[] } };

export function composeForm(
  target: AcademicTarget,
  effectiveProfile: EffectiveProfile | null,
  agreements: AgreementOption[] = [],
): CompositionResult {
  const offerType = target.kind === 'seminar'
    ? 'seminar'
    : target.offer?.type || target.offerType || '';

  if (offerType === 'doctorado') {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OFFER_TYPE',
        message: 'Doctorados no están soportados actualmente.',
        issues: ['unsupported_offer_type: doctorado'],
      },
    };
  }

  if (!effectiveProfile) {
    return {
      ok: false,
      error: {
        code: 'NO_ACTIVE_PROFILE',
        message: `No hay un perfil activo configurado para ${offerType || target.title}.`,
        issues: [`no_active_profile: ${offerType}`],
      },
    };
  }

  if (target.kind === 'seminar' && effectiveProfile.type !== 'seminar') {
    return {
      ok: false,
      error: {
        code: 'PROFILE_MISMATCH',
        message: 'El perfil no coincide con el tipo de destino.',
        issues: ['profile_mismatch'],
      },
    };
  }

  const { steps, fields, documents: docRules, recommendationLettersCount } = effectiveProfile.definition;

  // Compose inputs
  const targetOrientations = target.orientations ?? [];
  const targetMentions = target.mentions ?? [];

  const finalInputs: InputDefinition[] = [];

  for (const fieldRule of fields) {
    // Condition checks
    if (fieldRule.condition === 'has_orientations' && targetOrientations.length === 0) {
      continue;
    }
    if (fieldRule.condition === 'has_mentions' && targetMentions.length === 0) {
      continue;
    }

    const baseUniversal = UNIVERSAL_INPUTS.find((u) => u.key === fieldRule.key);
    const baseSpecific = SUPPORTED_SPECIFIC_INPUTS[fieldRule.key];
    const base = baseUniversal ?? baseSpecific;

    finalInputs.push({
      key: fieldRule.key,
      label: fieldRule.label ?? base?.label ?? fieldRule.key,
      type: base?.type ?? 'text',
      required: fieldRule.required,
      position: fieldRule.order,
      stepId: fieldRule.stepId,
      condition: fieldRule.condition,
      optionsSource:
        fieldRule.key === 'orientacion'
          ? 'wordpress.orientaciones'
          : fieldRule.key === 'mencion'
          ? 'wordpress.menciones'
          : base?.optionsSource,
      spreadsheetColumn: base?.spreadsheetColumn ?? base?.label,
    });
  }

  finalInputs.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Compose documents
  const finalDocuments: DocumentDefinition[] = [];

  for (const docRule of docRules) {
    const base = DOCUMENT_DEFINITIONS[docRule.key];

    finalDocuments.push({
      key: docRule.key,
      label: docRule.label ?? base?.label ?? docRule.key,
      required: docRule.required,
      canDefer: docRule.canDefer,
      maxFiles: docRule.maxFiles ?? base?.maxFiles ?? 1,
      maxBytes: docRule.maxBytes ?? base?.maxBytes ?? 10 * 1024 * 1024,
      acceptedMimeTypes: docRule.acceptedMimeTypes ?? base?.acceptedMimeTypes ?? ['application/pdf'],
      position: docRule.order,
      stepId: docRule.stepId,
    });
  }

  finalDocuments.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Compute effective revision
  const revisionPayload = `${target.configRevision}:${effectiveProfile.versionId}:${JSON.stringify(effectiveProfile.definition)}`;
  const hash = crypto.createHash('sha256').update(revisionPayload).digest('hex');
  const effectiveRevision = `sha256:${hash}`;

  const sortedSteps = [...steps]
    .filter((step) => step.id !== 'orientacion' || targetOrientations.length > 0 || targetMentions.length > 0)
    .sort((a, b) => a.order - b.order);

  return {
    ok: true,
    value: {
      targetId: target.id,
      kind: target.kind,
      title: target.title,
      offerType: effectiveProfile.type,
      profileVersionId: effectiveProfile.versionId,
      effectiveRevision,
      registrationOpen: target.registrationOpen,
      configRevision: target.configRevision,
      steps: sortedSteps,
      inputs: finalInputs,
      documents: finalDocuments,
      orientations: targetOrientations,
      mentions: targetMentions,
      agreements,
      recommendationLettersCount,
    },
  };
}
