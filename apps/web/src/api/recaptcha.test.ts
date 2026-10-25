import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./client.js', () => ({
  apiClient: { getPublicConfig: vi.fn() },
}));

import { apiClient } from './client.js';
import { getRecaptchaToken } from './recaptcha.js';

describe('getRecaptchaToken', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    delete window.grecaptcha;
  });

  it('returns undefined without loading anything when reCAPTCHA is not enabled', async () => {
    vi.mocked(apiClient.getPublicConfig).mockResolvedValue({ recaptcha: { enabled: false } });
    const before = document.head.querySelectorAll('script').length;

    expect(await getRecaptchaToken()).toBeUndefined();
    expect(document.head.querySelectorAll('script').length).toBe(before);
  });

  it('returns undefined instead of blocking the form when the config cannot be read', async () => {
    vi.mocked(apiClient.getPublicConfig).mockRejectedValue(new Error('sin red'));
    expect(await getRecaptchaToken()).toBeUndefined();
  });

  it('executes reCAPTCHA with the configured site key and action', async () => {
    vi.mocked(apiClient.getPublicConfig).mockResolvedValue({
      recaptcha: { enabled: true, siteKey: 'sitio-publico', action: 'submit_preinscription' },
    });
    const execute = vi.fn().mockResolvedValue('token-123');
    window.grecaptcha = { ready: (callback: () => void) => callback(), execute };

    expect(await getRecaptchaToken()).toBe('token-123');
    expect(execute).toHaveBeenCalledWith('sitio-publico', { action: 'submit_preinscription' });
  });

  it('returns undefined if Google rejects the execution', async () => {
    vi.mocked(apiClient.getPublicConfig).mockResolvedValue({
      recaptcha: { enabled: true, siteKey: 'sitio-publico', action: 'submit_preinscription' },
    });
    window.grecaptcha = { ready: (callback: () => void) => callback(), execute: vi.fn().mockRejectedValue(new Error('x')) };

    expect(await getRecaptchaToken()).toBeUndefined();
  });
});
