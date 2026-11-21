import { createHash } from 'node:crypto';
import { getCountries } from 'libphonenumber-js';

const GRAPH_API_VERSION = 'v25.0';

export interface SubmitApplicationEvent {
  /** Mismo valor que usa el navegador como eventID: Meta deduplica Pixel y CAPI por este identificador. */
  eventId: string;
  eventSourceUrl?: string;
  clientIp?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  contentName?: string;
  contentId?: string;
  /** Abreviación de la oferta; si existe, content_ids la usa en lugar de contentId. */
  offerCode?: string;
  /** Datos personales crudos: se normalizan y hashean aquí antes de salir hacia Meta. */
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Nombre del país en español, tal como se guarda en paisResidencia. */
  country?: string;
}

export interface MetaCapiTracker {
  pixelId: string;
  sendSubmitApplication(event: SubmitApplicationEvent): Promise<void>;
}

export interface MetaCapiOptions {
  pixelId: string;
  accessToken: string;
  /** Código de «Probar eventos» de Events Manager; solo para verificar la integración. */
  testEventCode?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Cookies `_fbp` y `_fbc` que el píxel deja en el navegador del postulante. */
export function readMetaCookies(cookieHeader: string | undefined): { fbp?: string; fbc?: string } {
  const result: { fbp?: string; fbc?: string } = {};
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    const value = rest.join('=').trim();
    if (!value || value.length > 256) continue;
    if (name === '_fbp') result.fbp = value;
    if (name === '_fbc') result.fbc = value;
  }
  return result;
}

/** El identificador externo es un hash del envío: nunca datos personales del postulante. */
function hashed(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const plainName = (text: string) => plain(text).replace(/[^a-z ]/g, '').trim();

// Nombre en español -> ISO-2; misma lista y nombres que apps/web/src/domain/countries.ts.
const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['es'], { type: 'region' }) : undefined;
const ISO_BY_NAME = new Map(getCountries().map((code) => [plain(regionNames?.of(code) ?? code), code.toLowerCase()]));

/** Valor normalizado según Meta y hasheado; vacío tras normalizar -> se omite. */
function addHashed(target: Record<string, string>, key: string, value: string | undefined, normalize: (v: string) => string) {
  const normalized = normalize(value ?? '');
  if (normalized) target[key] = hashed(normalized);
}

/**
 * Envía SubmitApplication por Conversions API. El seguimiento es auxiliar: `sendSubmitApplication`
 * nunca lanza, para que un fallo de Meta no afecte la preinscripción.
 */
export function createMetaCapiTracker(options: MetaCapiOptions): MetaCapiTracker {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());

  return {
    pixelId: options.pixelId,
    async sendSubmitApplication(event) {
      try {
        const userData: Record<string, string> = { external_id: hashed(event.eventId) };
        if (event.clientIp) userData.client_ip_address = event.clientIp;
        if (event.userAgent) userData.client_user_agent = event.userAgent;
        if (event.fbp) userData.fbp = event.fbp;
        if (event.fbc) userData.fbc = event.fbc;
        addHashed(userData, 'em', event.email, (v) => v.trim().toLowerCase());
        addHashed(userData, 'ph', event.phone, (v) => v.replace(/\D/g, ''));
        addHashed(userData, 'fn', event.firstName, plainName);
        addHashed(userData, 'ln', event.lastName, plainName);
        addHashed(userData, 'country', event.country, (v) => ISO_BY_NAME.get(plain(v)) ?? '');

        const body: Record<string, unknown> = {
          data: [
            {
              event_name: 'SubmitApplication',
              event_time: Math.floor(now() / 1000),
              event_id: event.eventId,
              action_source: 'website',
              ...(event.eventSourceUrl ? { event_source_url: event.eventSourceUrl } : {}),
              user_data: userData,
              custom_data: {
                content_category: 'preinscripcion',
                ...(event.contentName ? { content_name: event.contentName } : {}),
                ...(event.offerCode
                  ? { offer_code: event.offerCode, content_ids: [event.offerCode] }
                  : event.contentId ? { content_ids: [event.contentId] } : {}),
              },
            },
          ],
        };
        if (options.testEventCode) body.test_event_code = options.testEventCode;

        const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(options.pixelId)}/events`;
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.accessToken}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.warn(`[Meta] CAPI respondió HTTP ${res.status}`);
      } catch (error) {
        console.warn('[Meta] No se pudo enviar SubmitApplication:', error instanceof Error ? error.message : error);
      }
    },
  };
}

/** Lee META_PIXEL_ID y META_CAPI_ACCESS_TOKEN; sin ambos, no hay seguimiento. */
export function createMetaCapiTrackerFromEnv(env: NodeJS.ProcessEnv = process.env): MetaCapiTracker | undefined {
  const pixelId = env.META_PIXEL_ID?.trim();
  const accessToken = env.META_CAPI_ACCESS_TOKEN?.trim();
  if (!pixelId || !accessToken) return undefined;
  return createMetaCapiTracker({ pixelId, accessToken, testEventCode: env.META_CAPI_TEST_EVENT_CODE?.trim() || undefined });
}
