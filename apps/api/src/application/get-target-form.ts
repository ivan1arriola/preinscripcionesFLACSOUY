import type { FormDefinition } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import { composeForm } from '../domain/form-composition.js';

export type GetTargetFormResult =
  | { ok: true; form: FormDefinition }
  | { ok: false; code: 'NOT_FOUND' | 'INCOMPATIBLE_FORM' | 'CLOSED'; message: string; issues?: string[] };

export async function getTargetForm(
  catalog: AcademicCatalog,
  targetId: string
): Promise<GetTargetFormResult> {
  const target = await catalog.getTarget(targetId);

  if (!target) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `No se encontró el destino académico con ID "${targetId}".`,
    };
  }

  const composition = composeForm(target);
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
