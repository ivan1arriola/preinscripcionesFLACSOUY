import type { EncryptedSettingsService } from '../security/encrypted-settings.js';
import { MauticClient, type MauticCredentials } from './mautic-client.js';

export const SETTING_MAUTIC_BASE_URL = 'mautic_base_url';
export const SETTING_MAUTIC_CLIENT_ID = 'mautic_client_id';
export const SETTING_MAUTIC_CLIENT_SECRET = 'mautic_client_secret';
export const SETTING_MAUTIC_CONTACTS_ENABLED = 'mautic_contacts_enabled';
export const SETTING_MAUTIC_TEMPLATE_APPLICANT_ID = 'mautic_template_applicant_id';
export const SETTING_MAUTIC_TEMPLATE_TEAM_ID = 'mautic_template_team_id';
export const SETTING_MAUTIC_ENROLLMENT_NOTIFY_ENABLED = 'mautic_enrollment_notify_enabled';
export const SETTING_MAUTIC_ENROLLMENT_SECRET = 'mautic_enrollment_secret';
export const SETTING_MAUTIC_LAST_TESTED_AT = 'mautic_last_tested_at';

/** Igual que WebhookSignature::MIN_SECRET_LENGTH del plugin de Mautic. */
export const MIN_ENROLLMENT_SECRET_LENGTH = 32;
export const SETTING_MAUTIC_LAST_TEST_STATUS = 'mautic_last_test_status';
export const SETTING_MAUTIC_LAST_TEST_ERROR = 'mautic_last_test_error';

export interface MauticConfig {
  baseUrl: string;
  /** Clave Pública. */
  clientId: string;
  /** Clave Secreta: nunca se devuelve al navegador. */
  clientSecret: string;
  /** Crear/actualizar el contacto del postulante en cada preinscripción. */
  contactsEnabled: boolean;
  /** Plantilla de Mautic para el correo al postulante. */
  applicantTemplateId: number | null;
  /** Plantilla de Mautic para los correos al equipo (oferta/seminario y maestros). */
  teamTemplateId: number | null;
  /** Avisar a Mautic de cada preinscripción a una oferta, para sacar al postulante de su campaña. */
  enrollmentNotifyEnabled: boolean;
  /** Secreto HMAC compartido con el plugin de Mautic: nunca se devuelve al navegador. */
  enrollmentSecret: string;
  lastTestedAt?: string | null;
  lastTestStatus?: 'ok' | 'error' | null;
  lastTestError?: string | null;
}

export interface MaskedMauticConfig extends Omit<MauticConfig, 'clientSecret' | 'enrollmentSecret'> {
  hasClientSecret: boolean;
  hasEnrollmentSecret: boolean;
}

export function hasMauticCredentials(config: MauticConfig): boolean {
  return /^https?:\/\//.test(config.baseUrl) && config.clientId.length > 0 && config.clientSecret.length > 0;
}

/** Destino del aviso de inscripción, o null si falta la URL de Mautic o el secreto. */
export function enrollmentWebhook(config: MauticConfig): { url: string; secret: string } | null {
  if (!/^https?:\/\//.test(config.baseUrl) || config.enrollmentSecret.length < MIN_ENROLLMENT_SECRET_LENGTH) {
    return null;
  }
  return { url: `${config.baseUrl}/flacso/enrollments`, secret: config.enrollmentSecret };
}

/** Encolar si está activado; el worker espera hasta que el destino esté configurado. */
export function shouldQueueEnrollmentNotice(config: MauticConfig): boolean {
  return config.enrollmentNotifyEnabled;
}

export function mauticCredentials(config: MauticConfig): MauticCredentials {
  return { baseUrl: config.baseUrl, clientId: config.clientId, clientSecret: config.clientSecret };
}

/** Un cliente por juego de credenciales: conserva el token OAuth2 entre lotes. */
export function createMauticClientCache(): (config: MauticConfig) => MauticClient {
  let cached: { key: string; client: MauticClient } | null = null;
  return (config) => {
    const key = `${config.baseUrl}|${config.clientId}|${config.clientSecret}`;
    if (cached?.key !== key) {
      cached = { key, client: new MauticClient(mauticCredentials(config)) };
    }
    return cached.client;
  };
}

function parseTemplateId(raw: string | null): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function loadMauticConfig(service: EncryptedSettingsService): Promise<MauticConfig> {
  return {
    baseUrl: ((await service.getEncryptedSetting(SETTING_MAUTIC_BASE_URL)) ?? '').trim().replace(/\/+$/, ''),
    clientId: ((await service.getEncryptedSetting(SETTING_MAUTIC_CLIENT_ID)) ?? '').trim(),
    clientSecret: ((await service.getEncryptedSetting(SETTING_MAUTIC_CLIENT_SECRET)) ?? '').trim(),
    contactsEnabled: (await service.getEncryptedSetting(SETTING_MAUTIC_CONTACTS_ENABLED)) === 'true',
    applicantTemplateId: parseTemplateId(await service.getEncryptedSetting(SETTING_MAUTIC_TEMPLATE_APPLICANT_ID)),
    teamTemplateId: parseTemplateId(await service.getEncryptedSetting(SETTING_MAUTIC_TEMPLATE_TEAM_ID)),
    enrollmentNotifyEnabled: (await service.getEncryptedSetting(SETTING_MAUTIC_ENROLLMENT_NOTIFY_ENABLED)) === 'true',
    enrollmentSecret: ((await service.getEncryptedSetting(SETTING_MAUTIC_ENROLLMENT_SECRET)) ?? '').trim(),
    lastTestedAt: await service.getEncryptedSetting(SETTING_MAUTIC_LAST_TESTED_AT),
    lastTestStatus: (await service.getEncryptedSetting(SETTING_MAUTIC_LAST_TEST_STATUS)) as 'ok' | 'error' | null,
    lastTestError: await service.getEncryptedSetting(SETTING_MAUTIC_LAST_TEST_ERROR),
  };
}

export async function saveMauticConfig(
  service: EncryptedSettingsService,
  input: {
    baseUrl?: string;
    clientId?: string;
    clientSecret?: string;
    contactsEnabled?: boolean;
    applicantTemplateId?: number | null;
    teamTemplateId?: number | null;
    enrollmentNotifyEnabled?: boolean;
    enrollmentSecret?: string;
  },
  updatedBy?: string
): Promise<void> {
  // Validar antes de escribir: un secreto corto no debe dejar la configuración a medio guardar.
  const enrollmentSecret = input.enrollmentSecret?.trim() ?? '';
  if (enrollmentSecret.length > 0 && enrollmentSecret.length < MIN_ENROLLMENT_SECRET_LENGTH) {
    throw new Error(`El secreto del aviso de inscripción debe tener al menos ${MIN_ENROLLMENT_SECRET_LENGTH} caracteres.`);
  }
  if (input.baseUrl !== undefined) {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
    if (baseUrl !== '' && !/^https:\/\/[^\s/]+/.test(baseUrl)) {
      throw new Error('La URL de Mautic debe comenzar con https://');
    }
    await service.setEncryptedSetting(SETTING_MAUTIC_BASE_URL, baseUrl, updatedBy);
  }
  if (input.clientId !== undefined) {
    await service.setEncryptedSetting(SETTING_MAUTIC_CLIENT_ID, input.clientId.trim(), updatedBy);
  }
  // Un secreto vacío significa "conservar el actual" (el navegador nunca lo recibe).
  if (input.clientSecret !== undefined && input.clientSecret.trim().length > 0) {
    await service.setEncryptedSetting(SETTING_MAUTIC_CLIENT_SECRET, input.clientSecret.trim(), updatedBy);
  }
  if (input.contactsEnabled !== undefined) {
    await service.setEncryptedSetting(SETTING_MAUTIC_CONTACTS_ENABLED, input.contactsEnabled ? 'true' : 'false', updatedBy);
  }
  if (input.enrollmentNotifyEnabled !== undefined) {
    await service.setEncryptedSetting(SETTING_MAUTIC_ENROLLMENT_NOTIFY_ENABLED, input.enrollmentNotifyEnabled ? 'true' : 'false', updatedBy);
  }
  // Igual que la Clave Secreta: vacío significa "conservar el actual".
  if (enrollmentSecret.length > 0) {
    await service.setEncryptedSetting(SETTING_MAUTIC_ENROLLMENT_SECRET, enrollmentSecret, updatedBy);
  }
  for (const [key, value] of [
    [SETTING_MAUTIC_TEMPLATE_APPLICANT_ID, input.applicantTemplateId],
    [SETTING_MAUTIC_TEMPLATE_TEAM_ID, input.teamTemplateId],
  ] as const) {
    if (value === undefined) continue;
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      throw new Error('Los IDs de plantilla de Mautic deben ser enteros positivos.');
    }
    await service.setEncryptedSetting(key, value === null ? '' : String(value), updatedBy);
  }
}

export async function recordMauticTest(
  service: EncryptedSettingsService,
  result: { ok: true } | { ok: false; error: string },
  updatedBy?: string
): Promise<void> {
  await service.setEncryptedSetting(SETTING_MAUTIC_LAST_TESTED_AT, new Date().toISOString(), updatedBy);
  await service.setEncryptedSetting(SETTING_MAUTIC_LAST_TEST_STATUS, result.ok ? 'ok' : 'error', updatedBy);
  await service.setEncryptedSetting(SETTING_MAUTIC_LAST_TEST_ERROR, result.ok ? '' : result.error.slice(0, 300), updatedBy);
}

export function maskMauticConfig(config: MauticConfig): MaskedMauticConfig {
  const { clientSecret, enrollmentSecret, ...rest } = config;
  return { ...rest, hasClientSecret: clientSecret.length > 0, hasEnrollmentSecret: enrollmentSecret.length > 0 };
}
