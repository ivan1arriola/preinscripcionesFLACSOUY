const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'fbclid'] as const;
const STORE_KEY = 'flacso:utm';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Una URL con UTM reemplaza lo guardado (30 días en localStorage); sin UTM se conserva la última fuente vigente. */
function capture(): Record<string, string> {
  try {
    const params = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    for (const key of KEYS) {
      const value = params.get(key)?.trim().slice(0, 200);
      if (value) found[key] = value;
    }
    if (Object.keys(found).length > 0) {
      localStorage.setItem(STORE_KEY, JSON.stringify({ utm: found, exp: Date.now() + TTL_MS }));
      return found;
    }
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (stored && typeof stored.exp === 'number' && stored.exp > Date.now()) return stored.utm ?? {};
    return {};
  } catch {
    return {}; // storage bloqueado: se pierde el UTM, nunca se rompe el envío
  }
}

// Se evalúa al cargar la app, antes de que el router cambie la URL.
const landed = capture();

export const getUtm = (): Record<string, string> => ({ ...landed, ...capture() });
