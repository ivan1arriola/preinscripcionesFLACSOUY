import { createHash } from 'node:crypto';

export interface Ga4SubmitApplicationEvent {
  /** Mismo identificador del envío que usa Meta; viaja como parámetro para poder cruzar los datos. */
  eventId: string;
  contentName?: string;
  offerCode?: string;
  country?: string;
  /** Cabecera Cookie de la petición: de ahí salen el client_id y la sesión de GA4. */
  cookieHeader?: string;
}

export interface Ga4Tracker {
  measurementId: string;
  sendSubmitApplication(event: Ga4SubmitApplicationEvent): Promise<void>;
}

export interface Ga4Options {
  measurementId: string;
  apiSecret: string;
  fetch?: typeof fetch;
}

/** `_ga` = GA1.<n>.<client>.<ts>: el client_id son los dos últimos tramos. */
export function readGaClientId(cookieHeader: string | undefined): string | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== '_ga') continue;
    const pieces = rest.join('=').trim().split('.');
    const [client, ts] = pieces.slice(-2);
    if (pieces.length >= 4 && /^\d+$/.test(client ?? '') && /^\d+$/.test(ts ?? '')) return `${client}.${ts}`;
  }
  return undefined;
}

/** `_ga_<ID>` = GS1.1.<session_id>... o GS2.1.s<session_id>$o...: une el evento a la sesión existente. */
export function readGaSessionId(cookieHeader: string | undefined, measurementId: string): string | undefined {
  const wanted = `_ga_${measurementId.replace(/^G-/, '')}`;
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== wanted) continue;
    const value = rest.join('=').trim();
    return /^GS1\.\d+\.(\d+)\./.exec(value)?.[1] ?? /^GS2\.\d+\.s(\d+)\$/.exec(value)?.[1];
  }
  return undefined;
}

/**
 * Envía submit_application a GA4 por Measurement Protocol, desde el servidor, para no depender del
 * navegador (bloqueadores, navegadores integrados). Es auxiliar: nunca lanza.
 */
export function createGa4Tracker(options: Ga4Options): Ga4Tracker {
  const doFetch = options.fetch ?? fetch;
  return {
    measurementId: options.measurementId,
    async sendSubmitApplication(event) {
      try {
        // Sin cookie _ga (gtag bloqueado) se deriva un client_id estable del envío.
        const digest = createHash('sha256').update(event.eventId).digest();
        const clientId = readGaClientId(event.cookieHeader) ?? `${digest.readUInt32BE(0)}.${digest.readUInt32BE(4)}`;
        const sessionId = readGaSessionId(event.cookieHeader, options.measurementId);
        const params: Record<string, string | number> = { engagement_time_msec: 1, flacso_event_id: event.eventId, source_channel: 'server' };
        if (event.contentName) params.content_name = event.contentName.slice(0, 100);
        if (event.offerCode) params.offer_code = event.offerCode.slice(0, 100);
        if (event.country) params.country = event.country.slice(0, 100);
        if (sessionId) params.session_id = sessionId;
        const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(options.measurementId)}&api_secret=${encodeURIComponent(options.apiSecret)}`;
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, events: [{ name: 'submit_application', params }] }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.warn(`[GA4] Measurement Protocol respondió HTTP ${res.status}`);
      } catch (error) {
        console.warn('[GA4] No se pudo enviar submit_application:', error instanceof Error ? error.message : error);
      }
    },
  };
}

/** Lee GA4_MEASUREMENT_ID y GA4_API_SECRET; sin ambos, no hay envío por servidor. */
export function createGa4TrackerFromEnv(env: NodeJS.ProcessEnv = process.env): Ga4Tracker | undefined {
  const measurementId = env.GA4_MEASUREMENT_ID?.trim();
  const apiSecret = env.GA4_API_SECRET?.trim();
  if (!measurementId || !apiSecret) return undefined;
  return createGa4Tracker({ measurementId, apiSecret });
}
