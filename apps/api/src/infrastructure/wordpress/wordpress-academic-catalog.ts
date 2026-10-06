import type { AcademicTarget, AgreementOption } from '@flacso/contracts';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { WordPressClient, WordPressTarget } from './wordpress-client.js';
import type { WordPressCache } from './wordpress-cache.js';

export interface WordPressAcademicCatalogOptions {
  ttlSeconds?: number;
  agreementsTtlSeconds?: number;
  cacheKey?: string;
}

export const DEFAULT_AGREEMENTS_TTL_SECONDS = 30 * 60;

export class WordPressAcademicCatalog implements AcademicCatalog {
  private readonly ttlSeconds: number;
  private readonly agreementsTtlSeconds: number;
  private readonly cacheKey: string;
  private agreementsRefresh?: Promise<AgreementOption[]>;

  constructor(
    private readonly client: WordPressClient,
    private readonly cache: WordPressCache,
    options?: WordPressAcademicCatalogOptions
  ) {
    this.ttlSeconds = options?.ttlSeconds ?? 60;
    this.agreementsTtlSeconds = options?.agreementsTtlSeconds ?? DEFAULT_AGREEMENTS_TTL_SECONDS;
    this.cacheKey = options?.cacheKey ?? 'wp_targets_v1';
  }

  async listTargets(): Promise<AcademicTarget[]> {
    // 1. Try fresh from cache
    const cached = await this.cache.get(this.cacheKey);
    if (cached) {
      return cached.targets.map((t) => this.mapTarget(t));
    }

    // 2. Serve stale data immediately and refresh in the background.
    // The public catalog must remain usable when WordPress is temporarily down.
    const stale = await this.cache.getStale(this.cacheKey);
    if (stale) {
      void this.refreshTargets().catch(() => undefined);
      return stale.targets.map((t) => this.mapTarget(t));
    }

    // 3. There is no cache yet, so the first request must reach WordPress.
    try {
      return await this.refreshTargets();
    } catch (err) {
      throw err;
    }
  }

  async getTarget(id: string): Promise<AcademicTarget | null> {
    const targets = await this.listTargets();
    return targets.find((t) => t.id === id) ?? null;
  }

  async revalidateTarget(id: string): Promise<AcademicTarget | null> {
    // Bypass cache to get authoritative state from WordPress
    const fresh = await this.client.getPreinscriptions();
    await this.cache.set(this.cacheKey, fresh, this.ttlSeconds);
    const target = fresh.targets.find((t) => t.id === id);
    return target ? this.mapTarget(target) : null;
  }

  async revalidateTargets(): Promise<AcademicTarget[]> {
    // Bypass cache to get authoritative state from WordPress
    return this.refreshTargets();
  }

  async listAgreements(): Promise<AgreementOption[]> {
    const cached = await this.cache.getAgreements();
    if (cached) return cached;

    const stale = await this.cache.getStaleAgreements();
    if (stale) {
      void this.refreshAgreements().catch(() => undefined);
      return stale;
    }

    return this.refreshAgreements();
  }

  private async refreshTargets(): Promise<AcademicTarget[]> {
    const fresh = await this.client.getPreinscriptions();
    await this.cache.set(this.cacheKey, fresh, this.ttlSeconds);
    return fresh.targets.map((t) => this.mapTarget(t));
  }

  private refreshAgreements(): Promise<AgreementOption[]> {
    if (!this.agreementsRefresh) {
      this.agreementsRefresh = this.client.getAgreements()
        .then(async (agreements) => {
          await this.cache.setAgreements(agreements, this.agreementsTtlSeconds);
          return agreements;
        })
        .finally(() => {
          this.agreementsRefresh = undefined;
        });
    }
    return this.agreementsRefresh;
  }

  private mapTarget(raw: WordPressTarget): AcademicTarget {
    const hasGenericCohortTitle = raw.kind === 'academic_offer' && /^cohorte(?:\s|$)/iu.test(raw.title.trim());
    const title = hasGenericCohortTitle && raw.offer?.name
      ? `${raw.offer.name} — ${raw.title}`
      : raw.title;

    const offerType = raw.kind === 'seminar'
      ? 'seminar'
      : raw.offer?.type;

    return {
      id: raw.id,
      kind: raw.kind,
      title,
      offerType,
      notificationEmail: raw.notificationEmail && raw.notificationEmail.trim().length > 0 ? raw.notificationEmail.trim() : undefined,
      registrationOpen: raw.registrationOpen,
      registrationAvailability: raw.registrationAvailability,
      registrationWindow: {
        from: raw.registrationWindow?.from ?? null,
        until: raw.registrationWindow?.until ?? null,
      },
      configRevision: raw.configRevision,
      wordpress: raw.wordpress,
      offer: raw.offer,
      seminar: raw.seminar,
      cohort: raw.cohort,
      edition: raw.edition,
      orientations: raw.orientations ?? [],
      mentions: raw.mentions ?? [],
      urls: {
        public: raw.urls.public ?? undefined,
        wordpress: raw.urls.wordpress ?? undefined,
        edit: raw.urls.edit ?? undefined,
        legacyRegistration: raw.urls.legacyRegistration ?? undefined,
      },
    };
  }
}
