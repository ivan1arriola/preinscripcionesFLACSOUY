import { describe, expect, it } from 'vitest';
import type { AcademicTarget } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { OfferRegistrationLinkRepository } from '../ports/offer-registration-link-repository.js';
import { InMemoryOfferRegistrationLinkRepository } from '../infrastructure/database/in-memory-offer-registration-link-repository.js';
import { RegisteredLinkAcademicCatalog } from './registered-link-catalog.js';

const silent = { info: () => undefined, error: () => undefined };

function offerTarget(offerId: number, legacyRegistration?: string, cohortId = offerId * 10): AcademicTarget {
  return {
    id: `target_${cohortId}`,
    kind: 'academic_offer',
    title: `Oferta ${offerId}`,
    registrationOpen: true,
    configRevision: 'sha256:x',
    wordpress: { offerId, cohortId },
    urls: legacyRegistration ? { legacyRegistration } : {},
  } as AcademicTarget;
}

function seminarTarget(): AcademicTarget {
  return {
    id: 'target_s',
    kind: 'seminar',
    title: 'Seminario',
    registrationOpen: true,
    configRevision: 'sha256:x',
    wordpress: { seminarId: 7, editionId: 70 },
    urls: { legacyRegistration: 'https://preinscripciones.flacso.edu.uy/seminario/s/' },
  } as AcademicTarget;
}

function catalogOf(targets: () => AcademicTarget[]): AcademicCatalog {
  return {
    listTargets: async () => targets(),
    getTarget: async (id) => targets().find((t) => t.id === id) ?? null,
    revalidateTarget: async (id) => targets().find((t) => t.id === id) ?? null,
    revalidateTargets: async () => targets(),
  };
}

describe('RegisteredLinkAcademicCatalog', () => {
  it('registra el enlace de cada oferta la primera vez y no escribe de nuevo mientras no cambie', async () => {
    const links = new InMemoryOfferRegistrationLinkRepository();
    const calls: string[] = [];
    const spy: OfferRegistrationLinkRepository = {
      list: () => links.list(),
      register: (id, path) => {
        calls.push(`${id}:${path}`);
        return links.register(id, path);
      },
    };
    const catalog = new RegisteredLinkAcademicCatalog(
      catalogOf(() => [
        offerTarget(1, 'https://preinscripciones.flacso.edu.uy/oferta/maestria/', 11),
        offerTarget(1, 'https://preinscripciones.flacso.edu.uy/oferta/maestria/', 12),
        seminarTarget(),
      ]),
      spy,
      silent
    );

    await catalog.listTargets();
    await catalog.listTargets();

    expect(calls).toEqual(['1:/oferta/maestria/']);
    expect((await links.list()).map((l) => [l.offerWpId, l.path])).toEqual([[1, '/oferta/maestria/']]);
  });

  it('no registra los seminarios', async () => {
    const links = new InMemoryOfferRegistrationLinkRepository();
    await new RegisteredLinkAcademicCatalog(catalogOf(() => [seminarTarget()]), links, silent).listTargets();
    expect(await links.list()).toEqual([]);
  });

  it('actualiza el enlace solo cuando WordPress publica uno distinto', async () => {
    const links = new InMemoryOfferRegistrationLinkRepository();
    let published = 'https://preinscripciones.flacso.edu.uy/oferta/vieja/';
    const catalog = new RegisteredLinkAcademicCatalog(catalogOf(() => [offerTarget(1, published)]), links, silent);

    await catalog.listTargets();
    published = 'https://preinscripciones.flacso.edu.uy/oferta/nueva/';
    await catalog.listTargets();

    expect((await links.list())[0]?.path).toBe('/oferta/nueva/');
  });

  it('si WordPress deja de publicar el enlace, usa el registrado', async () => {
    const links = new InMemoryOfferRegistrationLinkRepository();
    let published: string | undefined = 'https://preinscripciones.flacso.edu.uy/oferta/maestria/';
    const catalog = new RegisteredLinkAcademicCatalog(catalogOf(() => [offerTarget(1, published)]), links, silent);

    await catalog.listTargets();
    published = undefined;
    const [target] = await catalog.listTargets();

    expect(target?.urls?.legacyRegistration).toBe('/oferta/maestria/');
    expect((await links.list())[0]?.path).toBe('/oferta/maestria/');
  });

  it('conserva el enlace publicado por WordPress tal como llegó', async () => {
    const url = 'https://preinscripciones.flacso.edu.uy/oferta/maestria/';
    const catalog = new RegisteredLinkAcademicCatalog(
      catalogOf(() => [offerTarget(1, url)]),
      new InMemoryOfferRegistrationLinkRepository(),
      silent
    );
    expect((await catalog.listTargets())[0]?.urls?.legacyRegistration).toBe(url);
  });

  it('un fallo del registro no rompe el catálogo', async () => {
    const broken: OfferRegistrationLinkRepository = {
      list: async () => {
        throw new Error('base caída');
      },
      register: async () => ({ outcome: 'registered' }),
    };
    const targets = [offerTarget(1, 'https://preinscripciones.flacso.edu.uy/oferta/maestria/')];
    const catalog = new RegisteredLinkAcademicCatalog(catalogOf(() => targets), broken, silent);
    expect(await catalog.listTargets()).toEqual(targets);
  });

  it('aplica el registro también a getTarget y a las copias en caché', async () => {
    const links = new InMemoryOfferRegistrationLinkRepository();
    await links.register(1, '/oferta/maestria/');
    const inner: AcademicCatalog = {
      ...catalogOf(() => [offerTarget(1)]),
      listCachedTargets: async () => [offerTarget(1)],
    };
    const catalog = new RegisteredLinkAcademicCatalog(inner, links, silent);

    expect((await catalog.getTarget('target_10'))?.urls?.legacyRegistration).toBe('/oferta/maestria/');
    expect((await catalog.listCachedTargets!(1000))?.[0]?.urls?.legacyRegistration).toBe('/oferta/maestria/');
  });
});
