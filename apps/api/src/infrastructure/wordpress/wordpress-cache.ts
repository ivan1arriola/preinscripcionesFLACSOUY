import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/schema.js';
import type { WordPressV1Response } from './wordpress-client.js';
import type { AgreementOption } from '@flacso/contracts';

export interface WordPressCache {
  get(key: string): Promise<WordPressV1Response | null>;
  getStale(key: string): Promise<WordPressV1Response | null>;
  set(key: string, data: WordPressV1Response, ttlSeconds: number): Promise<void>;
  getAgreements(): Promise<AgreementOption[] | null>;
  getStaleAgreements(): Promise<AgreementOption[] | null>;
  setAgreements(data: AgreementOption[], ttlSeconds: number): Promise<void>;
}

export class MemoryWordPressCache implements WordPressCache {
  private store = new Map<string, { data: WordPressV1Response; expiresAt: number }>();
  private agreements: { data: AgreementOption[]; expiresAt: number } | null = null;

  async get(key: string): Promise<WordPressV1Response | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) return null;
    return entry.data;
  }

  async getStale(key: string): Promise<WordPressV1Response | null> {
    const entry = this.store.get(key);
    return entry ? entry.data : null;
  }

  async set(key: string, data: WordPressV1Response, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async getAgreements(): Promise<AgreementOption[] | null> {
    if (!this.agreements || Date.now() > this.agreements.expiresAt) return null;
    return this.agreements.data;
  }

  async getStaleAgreements(): Promise<AgreementOption[] | null> {
    return this.agreements?.data ?? null;
  }

  async setAgreements(data: AgreementOption[], ttlSeconds: number): Promise<void> {
    this.agreements = { data, expiresAt: Date.now() + ttlSeconds * 1000 };
  }

}

export class PostgresWordPressCache implements WordPressCache {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async get(key: string): Promise<WordPressV1Response | null> {
    try {
      const now = new Date();
      const row = await (this.db as any)
        .selectFrom('technical_cache')
        .select(['payload', 'expires_at'])
        .where('key', '=', key)
        .where('expires_at', '>', now)
        .executeTakeFirst();

      if (!row) return null;
      return JSON.parse(row.payload) as WordPressV1Response;
    } catch {
      return null;
    }
  }

  async getStale(key: string): Promise<WordPressV1Response | null> {
    try {
      const row = await (this.db as any)
        .selectFrom('technical_cache')
        .select(['payload'])
        .where('key', '=', key)
        .executeTakeFirst();

      if (!row) return null;
      return JSON.parse(row.payload) as WordPressV1Response;
    } catch {
      return null;
    }
  }

  async set(key: string, data: WordPressV1Response, ttlSeconds: number): Promise<void> {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
      const payload = JSON.stringify(data);

      await (this.db as any)
        .insertInto('technical_cache')
        .values({
          key,
          payload,
          cached_at: now,
          expires_at: expiresAt,
        })
        .onConflict((oc: any) =>
          oc.column('key').doUpdateSet({
            payload,
            cached_at: now,
            expires_at: expiresAt,
          })
        )
        .execute();
    } catch {
      // Cache write failure must not break request execution
    }
  }

  async getAgreements(): Promise<AgreementOption[] | null> {
    return this.getAgreementCache(false);
  }

  async getStaleAgreements(): Promise<AgreementOption[] | null> {
    return this.getAgreementCache(true);
  }

  async setAgreements(data: AgreementOption[], ttlSeconds: number): Promise<void> {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
      const payload = JSON.stringify(data);

      await (this.db as any)
        .insertInto('technical_cache')
        .values({ key: 'wp_agreements_v1', payload, cached_at: now, expires_at: expiresAt })
        .onConflict((oc: any) =>
          oc.column('key').doUpdateSet({ payload, cached_at: now, expires_at: expiresAt })
        )
        .execute();
    } catch {
      // Cache write failure must not break request execution
    }
  }

  private async getAgreementCache(stale: boolean): Promise<AgreementOption[] | null> {
    try {
      const query = (this.db as any)
        .selectFrom('technical_cache')
        .select(['payload', 'expires_at'])
        .where('key', '=', 'wp_agreements_v1');
      const row = await (stale ? query : query.where('expires_at', '>', new Date())).executeTakeFirst();
      if (!row) return null;
      const parsed = JSON.parse(row.payload);
      return Array.isArray(parsed) ? parsed as AgreementOption[] : null;
    } catch {
      return null;
    }
  }
}
