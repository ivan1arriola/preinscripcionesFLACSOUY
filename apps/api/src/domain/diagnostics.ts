import type { AcademicTarget, DiagnosticTarget, DiagnosticStatus, RegistrationAvailability } from '@flacso/contracts';
import { SUPPORTED_OFFER_TYPES } from './form-profiles.js';
import { normalizePermalink, type PermalinkResolution } from './permalink-availability.js';

export function diagnoseTarget(
  target: AcademicTarget,
  activeProfileTypes: Set<string> = new Set(SUPPORTED_OFFER_TYPES),
  permalinkResolutions?: Map<string, PermalinkResolution>
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
  let registrationOpen = target.registrationOpen;
  let registrationAvailability: RegistrationAvailability | undefined = target.registrationAvailability;

  // Misma regla para cohortes y ediciones: un enlace lleva a un único destino abierto.
  const rawUrl = target.urls?.legacyRegistration;
  const permalink = rawUrl && rawUrl.trim() ? normalizePermalink(rawUrl) : null;
  const resolution = permalink && permalinkResolutions ? permalinkResolutions.get(permalink) : undefined;

  if (resolution) {
    registrationAvailability = resolution.status;
    if (resolution.status === 'conflict') {
      issues.push(resolution.issue ?? 'multiple_open_seminar_editions');
      status = 'incompatible';
      registrationOpen = false;
    } else if (resolution.status === 'closed') {
      registrationOpen = false;
      if (issues.length === 0) {
        status = 'closed';
      }
    } else if (resolution.status === 'open') {
      if (resolution.targetId === target.id) {
        registrationOpen = true;
        registrationAvailability = 'open';
        if (issues.length === 0) {
          status = 'operational';
        }
      } else {
        registrationOpen = false;
        registrationAvailability = 'closed';
        if (issues.length === 0) {
          status = 'closed';
        }
      }
    }
  } else {
    if (target.registrationAvailability === 'conflict') {
      issues.push(target.kind === 'seminar' ? 'multiple_open_seminar_editions' : 'multiple_open_cohorts');
      status = 'incompatible';
      registrationOpen = false;
    } else if (target.registrationAvailability === 'closed') {
      registrationOpen = false;
      if (issues.length === 0) {
        status = 'closed';
      }
    } else if (target.registrationAvailability === 'open') {
      registrationOpen = true;
      if (issues.length === 0) {
        status = 'operational';
      }
    } else if (!registrationOpen) {
      if (issues.length === 0) {
        status = 'closed';
      }
    }
  }

  if (issues.length > 0) {
    status = 'incompatible';
  }

  return {
    id: target.id,
    kind: target.kind,
    title: target.title,
    offerType: offerType || undefined,
    registrationOpen,
    registrationAvailability,
    configRevision: target.configRevision,
    status,
    issues,
    urls: target.urls,
  };
}
