import { apiClient } from './client.js';

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue: unknown[]; loaded?: boolean; version?: string; push?: unknown };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

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

/**
 * Registra SubmitApplication en el navegador. `eventId` es el id del envío: el servidor envía el mismo
 * evento por Conversions API con ese id y Meta deduplica. Nunca lanza ni retrasa la pantalla de éxito.
 */
export async function trackSubmitApplication(eventId: string, contentName?: string): Promise<void> {
  try {
    const { meta } = await apiClient.getPublicConfig();
    if (!meta?.pixelId) return;
    installPixel(meta.pixelId);
    window.fbq!('track', 'SubmitApplication', { content_category: 'preinscripcion', ...(contentName ? { content_name: contentName } : {}) }, { eventID: eventId });
  } catch {
    // El seguimiento es auxiliar: un fallo no afecta la preinscripción.
  }
}
