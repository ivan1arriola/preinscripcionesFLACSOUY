import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client.js';
import { trackSubmitApplication } from './meta-pixel.js';

afterEach(() => {
  delete window.fbq;
  delete window._fbq;
  vi.restoreAllMocks();
});

describe('trackSubmitApplication', () => {
  it('no hace nada sin píxel configurado', async () => {
    vi.spyOn(apiClient, 'getPublicConfig').mockResolvedValue({ recaptcha: { enabled: false }, meta: { pixelId: null } });
    await trackSubmitApplication('sub_1');
    expect(window.fbq).toBeUndefined();
  });

  it('inicia el píxel y envía SubmitApplication con el id del envío como eventID', async () => {
    vi.spyOn(apiClient, 'getPublicConfig').mockResolvedValue({ recaptcha: { enabled: false }, meta: { pixelId: '945523174290178' } });
    await trackSubmitApplication('sub_1', 'Diploma en Género');
    const calls = (window.fbq!.queue as unknown[]).map((a) => Array.from(a as ArrayLike<unknown>));
    expect(calls[0]).toEqual(['init', '945523174290178']);
    expect(calls[1]).toEqual(['track', 'SubmitApplication', { content_category: 'preinscripcion', content_name: 'Diploma en Género' }, { eventID: 'sub_1' }]);
  });

  it('nunca lanza si la configuración falla', async () => {
    vi.spyOn(apiClient, 'getPublicConfig').mockRejectedValue(new Error('red'));
    await expect(trackSubmitApplication('sub_1')).resolves.toBeUndefined();
  });
});
