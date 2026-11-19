const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const STORE_KEY = 'flacso:utm';

/** Una URL con UTM reemplaza lo guardado; sin UTM se conserva la última campaña con la que llegó. */
function capture(): Record<string, string> {
  try {
    const params = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    for (const key of KEYS) {
      const value = params.get(key)?.trim().slice(0, 200);
      if (value) found[key] = value;
    }
    if (Object.keys(found).length > 0) sessionStorage.setItem(STORE_KEY, JSON.stringify(found));
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}');
  } catch {
    return {}; // sessionStorage bloqueado: se pierde el UTM, nunca se rompe el envío
  }
}

// Se evalúa al cargar la app, antes de que el router cambie la URL.
const landed = capture();

export const getUtm = (): Record<string, string> => ({ ...landed, ...capture() });
