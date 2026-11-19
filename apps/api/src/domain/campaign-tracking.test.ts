import { describe, expect, it } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import { buildCampaignTracking } from './campaign-tracking.js';

const offerTarget: AcademicTarget = {
  id: 't1',
  kind: 'academic_offer',
  title: 'Maestría en Género — Cohorte VI',
  registrationOpen: true,
  configRevision: 'rev',
  orientations: [],
  mentions: [],
  offer: { id: 1, slug: 'mg', name: 'Maestría en Género', abbreviation: 'MG', type: 'maestria' },
  cohort: { number: 6, name: 'Cohorte VI' },
};
const values = { nombre1: ' Lucía ', nombre2: 'Ana', apellido1: 'Méndez', apellido2: '', email: ' Lucia@Example.COM ' };

describe('buildCampaignTracking', () => {
  it('arma el registro de una oferta con cohorte y utm', () => {
    expect(buildCampaignTracking(offerTarget, values, { utm_source: 'ig', utm_evil: 'x' })).toEqual({
      nombre: 'Lucía Ana',
      apellido: 'Méndez',
      correo: 'lucia@example.com',
      oferta: 'Maestría en Género',
      ofertaTipo: 'academic_offer',
      edicion: 'Cohorte VI',
      utm: { utm_source: 'ig', utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null },
    });
  });

  it('usa la edición del seminario, o su número si no tiene nombre', () => {
    const seminar: AcademicTarget = {
      ...offerTarget,
      kind: 'seminar',
      offer: undefined,
      cohort: undefined,
      seminar: { id: 2, slug: 's', name: 'Seminario X', type: 'seminar' },
      edition: { number: 3 },
    };
    const row = buildCampaignTracking(seminar, values);
    expect(row.oferta).toBe('Seminario X');
    expect(row.ofertaTipo).toBe('seminar');
    expect(row.edicion).toBe('3');
  });

  it('deja edición nula si falta y cae al título sin nombre de oferta', () => {
    const row = buildCampaignTracking({ ...offerTarget, offer: undefined, cohort: undefined }, { email: 'a@b.c' }, { utm_term: '  ' });
    expect(row.edicion).toBeNull();
    expect(row.oferta).toBe(offerTarget.title);
    expect(row.nombre).toBe('');
    expect(row.utm.utm_term).toBeNull();
  });
});
