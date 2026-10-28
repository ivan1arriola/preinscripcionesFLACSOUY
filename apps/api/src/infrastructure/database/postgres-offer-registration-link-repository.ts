import type {
  OfferRegistrationLink,
  OfferRegistrationLinkRepository,
  OfferRegistrationOutcome,
} from '../../ports/offer-registration-link-repository.js';
import type { KyselyDb } from './kysely.js';

export class PostgresOfferRegistrationLinkRepository implements OfferRegistrationLinkRepository {
  constructor(private readonly db: KyselyDb) {}

  async list(): Promise<OfferRegistrationLink[]> {
    const rows = await this.db.selectFrom('offer_registration_links').selectAll().orderBy('offer_wp_id', 'asc').execute();
    return rows.map((row) => ({
      offerWpId: row.offer_wp_id,
      path: row.path,
      registeredAt: new Date(row.registered_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  async register(offerWpId: number, path: string): Promise<{ outcome: OfferRegistrationOutcome; previousPath?: string }> {
    return this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('offer_registration_links')
        .select('path')
        .where('offer_wp_id', '=', offerWpId)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) {
        // Otra instancia pudo registrarla a la vez: el conflicto no pisa lo ya registrado.
        const inserted = await trx
          .insertInto('offer_registration_links')
          .values({ offer_wp_id: offerWpId, path })
          .onConflict((oc) => oc.column('offer_wp_id').doNothing())
          .executeTakeFirst();
        return { outcome: Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0 ? 'registered' : 'unchanged' };
      }
      if (existing.path === path) return { outcome: 'unchanged' };
      await trx
        .updateTable('offer_registration_links')
        .set({ path, updated_at: new Date() })
        .where('offer_wp_id', '=', offerWpId)
        .execute();
      return { outcome: 'changed', previousPath: existing.path };
    });
  }
}
