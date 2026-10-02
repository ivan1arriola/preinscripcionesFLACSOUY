import type { AcademicTarget } from '@flacso/contracts';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { WordPressClient, WordPressTarget } from './wordpress-client.js';
import type { WordPressCache } from './wordpress-cache.js';

export interface WordPressAcademicCatalogOptions {
  ttlSeconds?: number;
  cacheKey?: string;
}

export class WordPressAcademicCatalog implements AcademicCatalog {
  private readonly ttlSeconds: number;
  private readonly cacheKey: string;

  constructor(
    private readonly client: WordPressClient,
    private readonly cache: WordPressCache,
    options?: WordPressAcademicCatalogOptions
  ) {
    this.ttlSeconds = options?.ttlSeconds ?? 60;
    this.cacheKey = options?.cacheKey ?? 'wp_targets_v1';
  }

  async listTargets(): Promise<AcademicTarget[]> {
    // 1. Try fresh from cache
    const cached = await this.cache.get(this.cacheKey);
    if (cached) {
      return cached.targets.map((t) => this.mapTarget(t));
    }

    // 2. Try fetching from upstream WordPress
    try {
      const fresh = await this.client.getPreinscriptions();
      await this.cache.set(this.cacheKey, fresh, this.ttlSeconds);
      return fresh.targets.map((t) => this.mapTarget(t));
    } catch (err) {
      // 3. Fallback to stale cache if available
      const stale = await this.cache.getStale(this.cacheKey);
      if (stale) {
        return stale.targets.map((t) => this.mapTarget(t));
      }
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
