import { apiClient, type PublicConfig } from './client.js';
import { findCountryByName } from '../domain/countries.js';

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue: unknown[]; loaded?: boolean; version?: string; push?: unknown };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let pixelStarted = false;
let ga4Started = false;

/** Código base oficial de Meta Pixel; solo se instala una vez. */
function installPixel(pixelId: string): void {
  if (!window.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as Fbq;
    window.fbq = fbq;
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }
  window.fbq!('init', pixelId);
}

/** Instala el píxel y registra el PageView inicial, una sola vez por carga de página. */
export function initPixel(pixelId: string): void {
  if (pixelStarted) return;
  pixelStarted = true;
  installPixel(pixelId);
  window.fbq!('track', 'PageView');
}

/** Instala gtag.js y configura GA4, una sola vez por carga de página. */
export function initGa4(measurementId: string): void {
  if (ga4Started) return;
  ga4Started = true;
  window.dataLayer = window.dataLayer || [];
  // gtag.js exige que se encole el objeto `arguments`, no un arreglo.
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
}

/** Arranca los seguimientos configurados en el servidor (píxel de Meta y GA4). */
export function initTracking(config: PublicConfig): void {
  if (config.meta?.pixelId) initPixel(config.meta.pixelId);
  if (config.ga4?.measurementId) initGa4(config.ga4.measurementId);
}

/**
 * Registra SubmitApplication en el navegador. `eventId` es el id del envío: el servidor envía el mismo
 * evento por Conversions API con ese id y Meta deduplica. Nunca lanza ni retrasa la pantalla de éxito.
 * `values` son los datos del formulario sin hash: el SDK del píxel los hashea antes de enviarlos.
 */
export async function trackSubmitApplication(eventId: string, contentName?: string, values: Record<string, string> = {}, offerCode?: string): Promise<void> {
  try {
    const config = await apiClient.getPublicConfig();
    initTracking(config);
    const country = findCountryByName(values.paisResidencia ?? '')?.code.toLowerCase();
    if (config.meta?.pixelId) {
      const phone = values.celular?.trim();
      const userData = Object.fromEntries(
        Object.entries({ em: values.email, fn: values.nombre1, ln: values.apellido1, ph: phone?.startsWith('+') ? phone : undefined, country })
          .map(([key, value]) => [key, value?.trim()])
          .filter(([, value]) => value && value !== '-')
      );
      window.fbq!('init', config.meta.pixelId, userData);
      window.fbq!('track', 'SubmitApplication', { content_category: 'preinscripcion', ...(contentName ? { content_name: contentName } : {}), ...(offerCode ? { offer_code: offerCode, content_ids: [offerCode] } : {}) }, { eventID: eventId });
    }
    if (config.ga4?.measurementId) {
      window.gtag!('event', 'submit_application', { ...(contentName ? { content_name: contentName } : {}), ...(offerCode ? { offer_code: offerCode } : {}), ...(country ? { country } : {}) });
    }
  } catch {
    // El seguimiento es auxiliar: un fallo no afecta la preinscripción.
  }
}
