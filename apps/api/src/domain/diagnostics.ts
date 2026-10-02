import type { AcademicTarget, DiagnosticTarget, DiagnosticStatus } from '@flacso/contracts';
import { SUPPORTED_OFFER_TYPES } from './form-profiles.js';

export function diagnoseTarget(
  target: AcademicTarget,
  activeProfileTypes: Set<string> = new Set(SUPPORTED_OFFER_TYPES)
): DiagnosticTarget {
  const issues: string[] = [];

  const offerType = target.kind === 'seminar'
    ? 'seminar'
    : target.offer?.type || target.offerType || '';

  if (!offerType) {
    issues.push('Falta especificar el tipo de oferta académica');
  } else if (offerType === 'doctorado') {
    issues.push('unsupported_offer_type: doctorado');
  } else if (!activeProfileTypes.has(offerType)) {
    issues.push(`unsupported_offer_type: ${offerType}`);
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
    offerType: offerType || undefined,
    registrationOpen: target.registrationOpen,
    configRevision: target.configRevision,
    status,
    issues,
    urls: target.urls,
  };
}
