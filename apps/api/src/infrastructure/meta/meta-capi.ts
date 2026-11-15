import { createHash } from 'node:crypto';

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
                ...(event.contentId ? { content_ids: [event.contentId] } : {}),
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
