import type { DiagnosticTarget } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import { diagnoseTarget } from '../domain/diagnostics.js';

export async function discoverTargets(catalog: AcademicCatalog): Promise<DiagnosticTarget[]> {
  const targets = await catalog.listTargets();
  return targets.map((t) => diagnoseTarget(t));
}
