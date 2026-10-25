import { describe, expect, it } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import { buildMauticEnrollmentNotice, signMauticEnrollment } from './mautic-enrollment.js';

const offerTarget: AcademicTarget = {
  id: 'target_1',
  kind: 'academic_offer',
  title: 'Maestría en Género — Cohorte VI',
  registrationOpen: true,
  configRevision: 'rev',
  orientations: [],
  mentions: [],
  offer: { id: 24162, slug: 'maestria-en-genero', name: 'MG', abbreviation: 'MG', type: 'maestria' },
  cohort: { number: 6, name: 'Cohorte VI' },
};

describe('mautic enrollment notice', () => {
  it('identifies the applicant and the WordPress offer', () => {
    expect(buildMauticEnrollmentNotice(offerTarget, { email: ' Valeria@Example.com ' }))
      .toEqual({ email: 'valeria@example.com', offerWpId: 24162 });
  });

  it('does not depend on accepting communications', () => {
    expect(buildMauticEnrollmentNotice(offerTarget, { email: 'v@example.com', aceptaComunicaciones: 'No' }))
      .toEqual({ email: 'v@example.com', offerWpId: 24162 });
  });

  it('skips seminars, offers without a WordPress ID and missing emails', () => {
    expect(buildMauticEnrollmentNotice({ ...offerTarget, kind: 'seminar' }, { email: 'v@example.com' })).toBeNull();
    expect(buildMauticEnrollmentNotice({ ...offerTarget, offer: undefined }, { email: 'v@example.com' })).toBeNull();
    expect(buildMauticEnrollmentNotice(offerTarget, { email: '  ' })).toBeNull();
  });

  it('signs like WebhookSignature::sign() in the Mautic plugin', () => {
    // Vector calculado con PHP: 'sha256=' . hash_hmac('sha256', '1800000000.{"a":1}', str_repeat('k', 32))
    expect(signMauticEnrollment('k'.repeat(32), '1800000000', '{"a":1}'))
      .toBe('sha256=4f0d00cc0602d74619f2c8a677ced8b329813cdfc143155dd963ea41b3486c47');
  });
});
