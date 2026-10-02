import type { AcademicTarget, DiagnosticTarget, DiagnosticStatus } from '@flacso/contracts';
import { ALL_SUPPORTED_INPUT_KEYS } from './form-definition.js';

export function diagnoseTarget(
  target: AcademicTarget,
  supportedKeys: Set<string> = ALL_SUPPORTED_INPUT_KEYS
): DiagnosticTarget {
  const issues: string[] = [];

  if (!target.form.valid) {
    issues.push(...target.form.issues);
  }

  const configuredInputs = target.form.inputs ?? [];
  for (const input of configuredInputs) {
    if (!supportedKeys.has(input.key)) {
      issues.push(`Clave de input no soportada: ${input.key}`);
    }
  }

  let status: DiagnosticStatus = 'operational';

  if (issues.length > 0) {
    status = 'incompatible';
  } else if (!target.registrationOpen) {
    status = 'closed';
  }

  return {
    id: target.id,
    kind: target.kind,
    title: target.title,
    registrationOpen: target.registrationOpen,
    configRevision: target.configRevision,
    status,
    issues,
    urls: target.urls,
  };
}
