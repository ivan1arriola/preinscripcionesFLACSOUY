import { afterEach, describe, expect, it, vi } from 'vitest';

// El módulo guarda estado ("ya inicializado"), por eso se importa de nuevo en cada prueba.
async function load(config: unknown) {
  vi.resetModules();
  const { apiClient } = await import('./client.js');
  vi.spyOn(apiClient, 'getPublicConfig').mockImplementation(config instanceof Error ? () => Promise.reject(config) : () => Promise.resolve(config as never));
  return import('./meta-pixel.js');
}

const fbqCalls = () => (window.fbq!.queue as unknown[]).map((a) => Array.from(a as ArrayLike<unknown>));
const gtagCalls = () => (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));

afterEach(() => {
  delete window.fbq;
  delete window._fbq;
  delete window.gtag;
  delete window.dataLayer;
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  vi.restoreAllMocks();
});

describe('trackSubmitApplication', () => {
  it('no hace nada sin píxel ni GA4 configurados', async () => {
    const { trackSubmitApplication } = await load({ recaptcha: { enabled: false }, meta: { pixelId: null }, ga4: { measurementId: null } });
    await trackSubmitApplication('sub_1');
    expect(window.fbq).toBeUndefined();
    expect(window.gtag).toBeUndefined();
  });

  it('envía SubmitApplication con eventID y datos del usuario sin hash, tras un único PageView', async () => {
    const { initTracking, trackSubmitApplication } = await load({ recaptcha: { enabled: false }, meta: { pixelId: '945523174290178' } });
    initTracking({ recaptcha: { enabled: false }, meta: { pixelId: '945523174290178' } });
    await trackSubmitApplication('sub_1', 'Diploma en Género', { email: 'Ana@Mail.com', nombre1: 'Ana', apellido1: 'Pérez', celular: '+59899123456', paisResidencia: 'Uruguay' });
    const calls = fbqCalls();
    expect(calls.filter((c) => c[0] === 'track' && c[1] === 'PageView')).toHaveLength(1);
    expect(calls.filter((c) => c[0] === 'init' && c.length === 2)).toHaveLength(1);
    expect(document.head.querySelectorAll('script[src*="fbevents.js"]')).toHaveLength(1);
    expect(calls).toContainEqual(['init', '945523174290178', { em: 'Ana@Mail.com', fn: 'Ana', ln: 'Pérez', ph: '+59899123456', country: 'uy' }]);
    expect(calls.at(-1)).toEqual(['track', 'SubmitApplication', { content_category: 'preinscripcion', content_name: 'Diploma en Género' }, { eventID: 'sub_1' }]);
  });

  it('suma offer_code y content_ids al evento del píxel', async () => {
    const { trackSubmitApplication } = await load({ recaptcha: { enabled: false }, meta: { pixelId: '945523174290178' } });
    await trackSubmitApplication('sub_1', 'Diploma en Género', {}, 'dgen');
    expect(fbqCalls().at(-1)).toEqual(['track', 'SubmitApplication', { content_category: 'preinscripcion', content_name: 'Diploma en Género', offer_code: 'dgen', content_ids: ['dgen'] }, { eventID: 'sub_1' }]);
  });

  it('dispara submit_application en GA4 e instala gtag una sola vez', async () => {
    const cfg = { recaptcha: { enabled: false }, ga4: { measurementId: 'G-TEST' } };
    const { initTracking, trackSubmitApplication } = await load(cfg);
    initTracking(cfg);
    await trackSubmitApplication('sub_1', 'Diploma en Género', { paisResidencia: 'Uruguay' });
    expect(document.head.querySelectorAll('script[src*="googletagmanager.com/gtag/js?id=G-TEST"]')).toHaveLength(1);
    expect(gtagCalls().filter((c) => c[0] === 'config')).toHaveLength(1);
    expect(gtagCalls().at(-1)).toEqual(['event', 'submit_application', { content_name: 'Diploma en Género', country: 'uy' }]);
  });

  it('nunca lanza si la configuración falla', async () => {
    const { trackSubmitApplication } = await load(new Error('red'));
    await expect(trackSubmitApplication('sub_1')).resolves.toBeUndefined();
  });
});
