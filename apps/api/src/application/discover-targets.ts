import type { DiagnosticTarget } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import { diagnoseTarget } from '../domain/diagnostics.js';
import { resolvePermalinks } from '../domain/permalink-availability.js';

export async function discoverTargets(catalog: AcademicCatalog): Promise<DiagnosticTarget[]> {
  const targets = await catalog.listTargets();
  const permalinkResolutions = resolvePermalinks(targets);
  return targets.map((t) => diagnoseTarget(t, undefined, permalinkResolutions));
}
