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
const AGREEMENTS_FAILURE_RETRY_BACKOFF_MS = 60 * 1000;
const TARGETS_FAILURE_RETRY_BACKOFF_MS = 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Destinatarios del "Correo de la Oferta Académica". Usa la lista multivaluada
 * y, si WordPress aún no la publica, el campo único anterior. Las direcciones
 * inválidas se descartan sin invalidar el resto del catálogo.
 */
function normalizeNotificationEmails(raw: WordPressTarget): string[] | undefined {
  const candidates = raw.notificationEmails ?? (raw.notificationEmail ? [raw.notificationEmail] : []);
  const emails = [
    ...new Set(candidates.map((email) => email.trim().toLowerCase()).filter((email) => EMAIL_PATTERN.test(email))),
  ];
  return emails.length > 0 ? emails : undefined;
}

export class WordPressAcademicCatalog implements AcademicCatalog {
  private readonly ttlSeconds: number;
  private readonly agreementsTtlSeconds: number;
  private readonly cacheKey: string;
  private agreementsRefresh?: Promise<AgreementOption[]>;
  private agreementsRetryAt = 0;
  private targetsRefresh?: Promise<AcademicTarget[]>;
  private targetsRetryAt = 0;

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
      if (Date.now() >= this.targetsRetryAt) {
        void this.refreshTargets().catch(() => undefined);
      }
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
    const targets = await this.refreshTargets();
    return targets.find((t) => t.id === id) ?? null;
  }

  async listCachedTargets(maxAgeMs: number): Promise<AcademicTarget[] | null> {
    const cached = await this.cache.getStaleWithAge(this.cacheKey);
    if (!cached || Date.now() - cached.cachedAt.getTime() > maxAgeMs) return null;
    return cached.data.targets.map((t) => this.mapTarget(t));
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
      if (Date.now() >= this.agreementsRetryAt) {
        void this.refreshAgreements().catch(() => undefined);
      }
      return stale;
    }

    if (Date.now() < this.agreementsRetryAt) return [];

    try {
      return await this.refreshAgreements();
    } catch {
      return [];
    }
  }

  /** Una sola consulta a WordPress a la vez; tras un fallo, la revalidación en segundo plano espera. */
  private refreshTargets(): Promise<AcademicTarget[]> {
    if (!this.targetsRefresh) {
      this.targetsRefresh = this.client.getPreinscriptions()
        .then(async (fresh) => {
          await this.cache.set(this.cacheKey, fresh, this.ttlSeconds);
          this.targetsRetryAt = 0;
          return fresh.targets.map((t) => this.mapTarget(t));
        })
        .catch((error) => {
          this.targetsRetryAt = Date.now() + TARGETS_FAILURE_RETRY_BACKOFF_MS;
          throw error;
        })
        .finally(() => {
          this.targetsRefresh = undefined;
        });
    }
    return this.targetsRefresh;
  }

  private refreshAgreements(): Promise<AgreementOption[]> {
    if (!this.agreementsRefresh) {
      this.agreementsRefresh = this.client.getAgreements()
        .then(async (agreements) => {
          await this.cache.setAgreements(agreements, this.agreementsTtlSeconds);
          this.agreementsRetryAt = 0;
          return agreements;
        })
        .catch((error) => {
          this.agreementsRetryAt = Date.now() + AGREEMENTS_FAILURE_RETRY_BACKOFF_MS;
          throw error;
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
      notificationEmails: normalizeNotificationEmails(raw),
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
