export interface OfferRegistrationLink {
  offerWpId: number;
  /** Ruta normalizada, por ejemplo "/oferta/mi-oferta/". */
  path: string;
  registeredAt: Date;
  updatedAt: Date;
}

export type OfferRegistrationOutcome = 'registered' | 'unchanged' | 'changed';

export interface OfferRegistrationLinkRepository {
  list(): Promise<OfferRegistrationLink[]>;
  /** Guarda la ruta la primera vez; después solo la actualiza si es distinta de la registrada. */
  register(offerWpId: number, path: string): Promise<{ outcome: OfferRegistrationOutcome; previousPath?: string }>;
}
