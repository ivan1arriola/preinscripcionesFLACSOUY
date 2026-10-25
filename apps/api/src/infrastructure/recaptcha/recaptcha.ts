import type { EncryptedSettingsService } from '../security/encrypted-settings.js';

export const SETTING_RECAPTCHA_ENABLED = 'recaptcha_enabled';
export const SETTING_RECAPTCHA_SITE_KEY = 'recaptcha_site_key';
export const SETTING_RECAPTCHA_SECRET_KEY = 'recaptcha_secret_key';
export const SETTING_RECAPTCHA_MIN_SCORE = 'recaptcha_min_score';

/** Acción que el navegador declara al pedir el token y que se exige al verificarlo. */
export const RECAPTCHA_ACTION = 'submit_preinscription';
export const DEFAULT_RECAPTCHA_MIN_SCORE = 0.5;

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

export interface RecaptchaConfig {
  enabled: boolean;
  /** Clave del sitio: es pública, el navegador la necesita para cargar reCAPTCHA. */
  siteKey: string;
  /** Clave secreta: nunca se devuelve al navegador. */
  secretKey: string;
  /** Puntaje mínimo (0 a 1) de reCAPTCHA v3 para aceptar el envío. */
  minScore: number;
}

export interface MaskedRecaptchaConfig extends Omit<RecaptchaConfig, 'secretKey'> {
  hasSecretKey: boolean;
}

export function isRecaptchaActive(config: RecaptchaConfig): boolean {
  return config.enabled && config.siteKey.length > 0 && config.secretKey.length > 0;
}

function parseMinScore(raw: string | null): number {
  const score = Number(raw);
  return raw !== null && raw !== '' && score >= 0.1 && score <= 0.9 ? score : DEFAULT_RECAPTCHA_MIN_SCORE;
}

export async function loadRecaptchaConfig(service: EncryptedSettingsService): Promise<RecaptchaConfig> {
  return {
    enabled: (await service.getEncryptedSetting(SETTING_RECAPTCHA_ENABLED)) === 'true',
    siteKey: ((await service.getEncryptedSetting(SETTING_RECAPTCHA_SITE_KEY)) ?? '').trim(),
    secretKey: ((await service.getEncryptedSetting(SETTING_RECAPTCHA_SECRET_KEY)) ?? '').trim(),
    minScore: parseMinScore(await service.getEncryptedSetting(SETTING_RECAPTCHA_MIN_SCORE)),
  };
}

export async function saveRecaptchaConfig(
  service: EncryptedSettingsService,
  input: { enabled?: boolean; siteKey?: string; secretKey?: string; minScore?: number },
  updatedBy?: string,
): Promise<void> {
  const current = await loadRecaptchaConfig(service);
  const next = {
    enabled: input.enabled ?? current.enabled,
    siteKey: input.siteKey !== undefined ? input.siteKey.trim() : current.siteKey,
    // Un secreto vacío significa "conservar el actual" (el navegador nunca lo recibe).
    secretKey: input.secretKey !== undefined && input.secretKey.trim() ? input.secretKey.trim() : current.secretKey,
    minScore: input.minScore ?? current.minScore,
  };

  if (next.enabled && (!next.siteKey || !next.secretKey)) {
    throw new Error('Para activar reCAPTCHA hacen falta la clave del sitio y la clave secreta.');
  }
  if (!(next.minScore >= 0.1 && next.minScore <= 0.9)) {
    throw new Error('El puntaje mínimo debe estar entre 0,1 y 0,9.');
  }

  await service.setEncryptedSetting(SETTING_RECAPTCHA_SITE_KEY, next.siteKey, updatedBy);
  if (next.secretKey !== current.secretKey) {
    await service.setEncryptedSetting(SETTING_RECAPTCHA_SECRET_KEY, next.secretKey, updatedBy);
  }
  await service.setEncryptedSetting(SETTING_RECAPTCHA_MIN_SCORE, String(next.minScore), updatedBy);
  await service.setEncryptedSetting(SETTING_RECAPTCHA_ENABLED, next.enabled ? 'true' : 'false', updatedBy);
}

export function maskRecaptchaConfig(config: RecaptchaConfig): MaskedRecaptchaConfig {
  const { secretKey, ...rest } = config;
  return { ...rest, hasSecretKey: secretKey.length > 0 };
}

export type RecaptchaVerification =
  | { status: 'passed'; score: number }
  | { status: 'failed'; reason: 'missing_token' | 'rejected' | 'low_score' | 'wrong_action' }
  /** Google no respondió: no se bloquea a los postulantes por una caída ajena. */
  | { status: 'unavailable' };

export interface VerifyRecaptchaInput {
  secretKey: string;
  token: string | undefined;
  remoteIp?: string;
  minScore: number;
  expectedAction?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type RecaptchaVerifier = (input: VerifyRecaptchaInput) => Promise<RecaptchaVerification>;

export const verifyRecaptchaToken: RecaptchaVerifier = async (input) => {
  const token = input.token?.trim();
  if (!token) return { status: 'failed', reason: 'missing_token' };

  const body = new URLSearchParams({ secret: input.secretKey, response: token });
  if (input.remoteIp) body.set('remoteip', input.remoteIp);

  let payload: { success?: boolean; score?: number; action?: string };
  try {
    const response = await (input.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(input.timeoutMs ?? 5000),
    });
    if (!response.ok) return { status: 'unavailable' };
    payload = (await response.json()) as typeof payload;
  } catch {
    return { status: 'unavailable' };
  }

  if (payload.success !== true) return { status: 'failed', reason: 'rejected' };
  if (input.expectedAction && payload.action !== input.expectedAction) {
    return { status: 'failed', reason: 'wrong_action' };
  }
  const score = typeof payload.score === 'number' ? payload.score : 0;
  if (score < input.minScore) return { status: 'failed', reason: 'low_score' };
  return { status: 'passed', score };
};
