import { describe, expect, it } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import { buildMauticContactSync, buildMauticContactTags, mauticSlug } from './mautic-contact.js';

const offerTarget: AcademicTarget = {
  id: 'target_1',
  kind: 'academic_offer',
  title: 'Maestría en Género — Cohorte VI',
  registrationOpen: true,
  configRevision: 'rev',
  orientations: [],
  mentions: [],
  offer: { id: 100, slug: 'maestria-en-genero', name: 'MG', abbreviation: 'MG', type: 'maestria' },
  cohort: { number: 6, name: 'Cohorte VI' },
};

describe('mautic contact', () => {
  it('slugs like FLACSO_Inquiry_Tag_Factory::slug', () => {
    expect(mauticSlug('  Educación, Innovación y Tecnologías ')).toBe('educacion-innovacion-y-tecnologias');
    expect(mauticSlug('MGPI')).toBe('mgpi');
    expect(mauticSlug('Niñez & Adolescencia')).toBe('ninez-adolescencia');
  });

  it('tags an offer cohort with the same code as inquiries', () => {
    expect(buildMauticContactTags(offerTarget)).toEqual(['preinscripcion-mg', 'mg-c6', 'origen-preinscripciones']);
  });

  it('falls back to the offer slug when there is no abbreviation', () => {
    const target = { ...offerTarget, offer: { ...offerTarget.offer!, abbreviation: '' } };
    expect(buildMauticContactTags(target)[0]).toBe('preinscripcion-maestria-en-genero');
  });

  it('tags a seminar edition by the seminar name', () => {
    const seminar: AcademicTarget = {
      ...offerTarget,
      kind: 'seminar',
      offer: undefined,
      cohort: undefined,
      seminar: { id: 200, slug: 'metodologia', name: 'Investigación Cualitativa', type: 'seminar' },
      edition: { number: 3, name: 'Edición 3' },
    };
    expect(buildMauticContactTags(seminar)).toEqual([
      'preinscripcion-investigacion-cualitativa',
      'investigacion-cualitativa-e3',
      'origen-preinscripciones',
    ]);
  });

  it('only sends stable profile fields, never document or birth data', () => {
    const sync = buildMauticContactSync(offerTarget, {
      email: ' Valeria@Example.com ',
      nombre1: 'Valeria',
      nombre2: '',
      apellido1: 'González',
      apellido2: 'Pérez',
      documento: '3.456.789-4',
      fechaNacimiento: '1990-05-15',
      paisResidencia: 'Uruguay',
      ocupacion: 'Docente',
    });

    expect(sync).toEqual({
      email: 'valeria@example.com',
      fields: {
        firstname: 'Valeria',
        lastname: 'González Pérez',
        flacso_origen: 'preinscripciones',
        flacso_pais: 'Uruguay',
        flacso_profesion: 'Docente',
      },
      tags: ['preinscripcion-mg', 'mg-c6', 'origen-preinscripciones'],
    });
  });

  it('returns null without an email', () => {
    expect(buildMauticContactSync(offerTarget, { nombre1: 'Sin correo' })).toBeNull();
  });
});
