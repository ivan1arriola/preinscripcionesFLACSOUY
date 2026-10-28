import type {
  OfferRegistrationLink,
  OfferRegistrationLinkRepository,
  OfferRegistrationOutcome,
} from '../../ports/offer-registration-link-repository.js';

export class InMemoryOfferRegistrationLinkRepository implements OfferRegistrationLinkRepository {
  private readonly links = new Map<number, OfferRegistrationLink>();

  async list(): Promise<OfferRegistrationLink[]> {
    return [...this.links.values()].sort((a, b) => a.offerWpId - b.offerWpId);
  }

  async register(offerWpId: number, path: string): Promise<{ outcome: OfferRegistrationOutcome; previousPath?: string }> {
    const now = new Date();
    const existing = this.links.get(offerWpId);
    if (!existing) {
      this.links.set(offerWpId, { offerWpId, path, registeredAt: now, updatedAt: now });
      return { outcome: 'registered' };
    }
    if (existing.path === path) return { outcome: 'unchanged' };
    this.links.set(offerWpId, { ...existing, path, updatedAt: now });
    return { outcome: 'changed', previousPath: existing.path };
  }
}
