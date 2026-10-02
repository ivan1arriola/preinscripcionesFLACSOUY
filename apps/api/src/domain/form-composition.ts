import type {
  AcademicTarget,
  FormDefinition,
  InputDefinition,
} from '@flacso/contracts';
import {
  UNIVERSAL_INPUTS,
  SUPPORTED_SPECIFIC_INPUTS,
  DOCUMENT_DEFINITIONS,
  ALL_SUPPORTED_INPUT_KEYS,
} from './form-definition.js';

export type CompositionResult =
  | { ok: true; value: FormDefinition }
  | { ok: false; error: { code: string; message: string; issues: string[] } };

export function composeForm(target: AcademicTarget): CompositionResult {
  const issues: string[] = [];

  if (!target.form.valid) {
    issues.push(...target.form.issues);
  }

  const seenKeys = new Set<string>();
  const configuredInputs = (target.form.inputs ?? []).filter(
    (configured) => target.kind !== 'seminar' || !['orientacion', 'mencion'].includes(configured.key)
  );

  // Check for duplicates and unknown keys in configured inputs
  for (const configured of configuredInputs) {
    if (seenKeys.has(configured.key)) {
      issues.push(`Clave de input duplicada: ${configured.key}`);
    } else {
      seenKeys.add(configured.key);
    }

    if (!ALL_SUPPORTED_INPUT_KEYS.has(configured.key)) {
      issues.push(`Clave de input no soportada: ${configured.key}`);
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'INCOMPATIBLE_FORM',
        message: 'El formulario contiene definiciones incompatibles o no soportadas.',
        issues,
      },
    };
  }

  // Merge universal inputs with configured inputs
  const finalInputs: InputDefinition[] = [];

  // Add universal inputs (unless overridden by specific configuration)
  for (const universal of UNIVERSAL_INPUTS) {
    const override = configuredInputs.find((c) => c.key === universal.key);
    if (override) {
      finalInputs.push({
        ...universal,
        position: override.position ?? universal.position,
        required: override.required ?? universal.required,
      });
    } else {
      finalInputs.push({ ...universal });
    }
  }

  // Add specific configured inputs
  for (const configured of configuredInputs) {
    if (UNIVERSAL_INPUTS.some((u) => u.key === configured.key)) {
      continue; // already handled
    }

    const baseDef = SUPPORTED_SPECIFIC_INPUTS[configured.key];
    if (baseDef) {
      finalInputs.push({
        ...baseDef,
        position: configured.position ?? 99,
        required: configured.required ?? baseDef.required,
      });
    }
  }

  // Sort inputs by position ascending
  finalInputs.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const documents = (target.form.documents ?? []).flatMap((configured) => {
    const base = DOCUMENT_DEFINITIONS[configured.key];
    if (!base) {
      issues.push(`Clave de documento no soportada: ${configured.key}`);
      return [];
    }
    return [{
      ...base,
      position: configured.position ?? 99,
      required: configured.required ?? base.required,
      maxFiles: configured.maxFiles ?? base.maxFiles,
      maxBytes: configured.maxBytes ?? base.maxBytes,
      acceptedMimeTypes: configured.acceptedMimeTypes ?? base.acceptedMimeTypes,
      canDefer: configured.canDefer ?? base.canDefer,
    }];
  });

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'INCOMPATIBLE_FORM',
        message: 'El formulario contiene definiciones incompatibles o no soportadas.',
        issues,
      },
    };
  }

  return {
    ok: true,
    value: {
      targetId: target.id,
      kind: target.kind,
      title: target.title,
      registrationOpen: target.registrationOpen,
      configRevision: target.configRevision,
      inputs: finalInputs,
      orientations: target.kind === 'seminar' ? [] : target.orientations ?? [],
      mentions: target.kind === 'seminar'
        ? []
        : target.mentions ?? target.orientations.flatMap((orientation) => orientation.mentions ?? []),
      documents,
    },
  };
}
