import { apiClient } from './client.js';

interface Grecaptcha {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

let scriptLoading: Promise<void> | null = null;

function loadRecaptchaScript(siteKey: string): Promise<void> {
  if (window.grecaptcha) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error('No se pudo cargar reCAPTCHA.'));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * Pide a Google un token de reCAPTCHA v3 para el envío. Devuelve `undefined` si reCAPTCHA no está activado
 * en el panel o si no se pudo cargar: en ese caso el servidor decide si exige o no el token.
 */
export async function getRecaptchaToken(): Promise<string | undefined> {
  try {
    const { recaptcha } = await apiClient.getPublicConfig();
    if (!recaptcha.enabled || !recaptcha.siteKey || !recaptcha.action) return undefined;

    await loadRecaptchaScript(recaptcha.siteKey);
    const grecaptcha = window.grecaptcha;
    if (!grecaptcha) return undefined;

    const { siteKey, action } = recaptcha;
    return await new Promise<string | undefined>((resolve) => {
      grecaptcha.ready(() => {
        grecaptcha.execute(siteKey, { action }).then(resolve, () => resolve(undefined));
      });
    });
  } catch {
    return undefined;
  }
}
