export const SUPPORTED_OFFER_TYPES = [
  'maestria',
  'especializacion',
  'diplomado',
  'diploma',
  'seminar',
] as const;

export type SupportedOfferType = (typeof SUPPORTED_OFFER_TYPES)[number];

export function isSupportedOfferType(type: string): type is SupportedOfferType {
  return (SUPPORTED_OFFER_TYPES as readonly string[]).includes(type);
}
