import type { DiagnosticTarget } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import { diagnoseTarget } from '../domain/diagnostics.js';
import { resolveSeminarPermalinks } from '../domain/seminar-permalink-availability.js';

export async function discoverTargets(catalog: AcademicCatalog): Promise<DiagnosticTarget[]> {
  const targets = await catalog.listTargets();
  const seminarResolutions = resolveSeminarPermalinks(targets);
  return targets.map((t) => diagnoseTarget(t, undefined, seminarResolutions));
}
