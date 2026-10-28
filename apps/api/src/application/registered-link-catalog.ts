import type { AcademicTarget, AgreementOption } from '@flacso/contracts';
import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { OfferRegistrationLinkRepository } from '../ports/offer-registration-link-repository.js';
import { normalizePermalink } from '../domain/permalink-availability.js';

/**
 * Registra el enlace de preinscripción de cada oferta académica la primera vez que
 * WordPress lo publica y no lo vuelve a tocar: solo cambia si WordPress publica otro.
 * Si WordPress deja de publicarlo, se usa el registrado. Un fallo del registro nunca
 * rompe el catálogo: se devuelven los destinos tal como llegaron.
 */
export class RegisteredLinkAcademicCatalog implements AcademicCatalog {
  listCachedTargets?: (maxAgeMs: number) => Promise<AcademicTarget[] | null>;
  listAgreements?: () => Promise<AgreementOption[]>;

  constructor(
    private readonly inner: AcademicCatalog,
    private readonly links: OfferRegistrationLinkRepository,
    private readonly log: Pick<Console, 'info' | 'error'> = console
  ) {
    if (inner.listCachedTargets) {
      this.listCachedTargets = async (maxAgeMs: number) => {
        const targets = await inner.listCachedTargets!(maxAgeMs);
        return targets ? this.apply(targets) : null;
      };
    }
    if (inner.listAgreements) {
      this.listAgreements = () => inner.listAgreements!();
    }
  }

  async listTargets(): Promise<AcademicTarget[]> {
    return this.apply(await this.inner.listTargets());
  }

  async getTarget(id: string): Promise<AcademicTarget | null> {
    const target = await this.inner.getTarget(id);
    return target ? ((await this.apply([target]))[0] ?? null) : null;
  }

  async revalidateTarget(id: string): Promise<AcademicTarget | null> {
    const target = await this.inner.revalidateTarget(id);
    return target ? ((await this.apply([target]))[0] ?? null) : null;
  }

  async revalidateTargets(): Promise<AcademicTarget[]> {
    return this.apply(await this.inner.revalidateTargets());
  }

  private async apply(targets: AcademicTarget[]): Promise<AcademicTarget[]> {
    try {
      const registered = new Map((await this.links.list()).map((link) => [link.offerWpId, link.path]));
      const published = new Map<number, string>();
      for (const target of targets) {
        const offerWpId = this.offerWpId(target);
        const raw = target.urls?.legacyRegistration?.trim();
        if (offerWpId !== undefined && raw) published.set(offerWpId, normalizePermalink(raw));
      }

      for (const [offerWpId, path] of published) {
        if (registered.get(offerWpId) === path) continue;
        const result = await this.links.register(offerWpId, path);
        registered.set(offerWpId, path);
        if (result.outcome === 'registered') {
          this.log.info(`[Enlaces] Oferta ${offerWpId}: enlace registrado ${path}`);
        } else if (result.outcome === 'changed') {
          this.log.info(`[Enlaces] Oferta ${offerWpId}: WordPress cambió el enlace ${result.previousPath} → ${path}`);
        }
      }

      return targets.map((target) => {
        const offerWpId = this.offerWpId(target);
        if (offerWpId === undefined || target.urls?.legacyRegistration?.trim()) return target;
        const path = registered.get(offerWpId);
        return path ? { ...target, urls: { ...target.urls, legacyRegistration: path } } : target;
      });
    } catch (error) {
      this.log.error('[Enlaces] No se pudo registrar el enlace de las ofertas; se usa el del catálogo.', error);
      return targets;
    }
  }

  private offerWpId(target: AcademicTarget): number | undefined {
    if (target.kind !== 'academic_offer') return undefined;
    const id = target.wordpress?.offerId ?? target.offer?.id;
    return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined;
  }
}
