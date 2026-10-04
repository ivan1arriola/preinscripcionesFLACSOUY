import type { EncryptedSettingsService } from '../security/encrypted-settings.js';

export const SETTING_EMAIL_NOTIFICATIONS_ENABLED = 'email_notifications_enabled';
export const SETTING_NOTIFICATION_MASTER_EMAILS = 'notification_master_emails';
export const SETTING_SES_AWS_ACCESS_KEY_ID = 'ses_aws_access_key_id';
export const SETTING_SES_AWS_SECRET_ACCESS_KEY = 'ses_aws_secret_access_key';
export const SETTING_SES_AWS_SESSION_TOKEN = 'ses_aws_session_token';
export const SETTING_SES_REGION = 'ses_region';
export const SETTING_SES_FROM_EMAIL = 'ses_from_email';
export const SETTING_SES_REPLY_TO_EMAIL = 'ses_reply_to_email';
export const SETTING_SES_CONFIGURATION_SET = 'ses_configuration_set';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseMasterEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let items: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      items = parsed.map(String);
    } else {
      items = [String(parsed)];
    }
  } catch {
    items = raw.split(/[\n,;]+/);
  }
  const unique = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim().toLowerCase();
    if (trimmed.length > 0 && EMAIL_REGEX.test(trimmed)) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique);
}

export function serializeMasterEmails(emails: string[]): string {
  const unique = new Set<string>();
  for (const email of emails) {
    const trimmed = email.trim().toLowerCase();
    if (trimmed.length > 0) {
      if (!EMAIL_REGEX.test(trimmed)) {
        throw new Error(`Correo electrónico inválido: ${email}`);
      }
      unique.add(trimmed);
    }
  }
  return JSON.stringify(Array.from(unique));
}

export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [local, domain] = parts;
  if (!local || !domain) return '***';
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

export function maskString(str: string): string {
  if (str.length <= 4) return '****';
  return `${str.slice(0, 2)}****${str.slice(-2)}`;
}

export interface SesCredentialsConfig {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  fromEmail: string;
  replyToEmail?: string;
  configurationSet?: string;
}

export interface ResolvedEmailConfig {
  enabled: boolean;
  provider: 'ses' | 'fake' | 'disabled';
  masterEmails: string[];
  ses?: SesCredentialsConfig;
}

export interface LoadEmailConfigOptions {
  isProduction?: boolean;
  providerOverride?: string;
}

export async function loadEmailConfig(
  settingsService: EncryptedSettingsService,
  options?: LoadEmailConfigOptions
): Promise<ResolvedEmailConfig> {
  const isProduction = options?.isProduction ?? process.env.NODE_ENV === 'production';
  const providerOverride = options?.providerOverride ?? process.env.EMAIL_PROVIDER;

  let enabledRaw: string | null = null;
  try {
    enabledRaw = await settingsService.getEncryptedSetting(SETTING_EMAIL_NOTIFICATIONS_ENABLED);
  } catch (error) {
    throw new Error(
      `APP_SETTINGS_ENCRYPTION_KEY es requerida para habilitar notificaciones por correo: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const enabled = enabledRaw === 'true';

  let rawMasters: string | null = null;
  try {
    rawMasters = await settingsService.getEncryptedSetting(SETTING_NOTIFICATION_MASTER_EMAILS);
  } catch {
    // If decryption key absent and not enabled, masters remains empty
  }
  const masterEmails = parseMasterEmails(rawMasters);

  if (!enabled) {
    return {
      enabled: false,
      provider: 'disabled',
      masterEmails,
    };
  }

  if (providerOverride === 'fake' || (!isProduction && providerOverride === 'mock')) {
    return {
      enabled: true,
      provider: 'fake',
      masterEmails,
    };
  }

  // Load SES configuration
  const accessKeyId = await settingsService.getEncryptedSetting(SETTING_SES_AWS_ACCESS_KEY_ID);
  const secretAccessKey = await settingsService.getEncryptedSetting(SETTING_SES_AWS_SECRET_ACCESS_KEY);
  const sessionToken = (await settingsService.getEncryptedSetting(SETTING_SES_AWS_SESSION_TOKEN)) || undefined;
  const region = await settingsService.getEncryptedSetting(SETTING_SES_REGION);
  const fromEmail = await settingsService.getEncryptedSetting(SETTING_SES_FROM_EMAIL);
  const replyToEmail = (await settingsService.getEncryptedSetting(SETTING_SES_REPLY_TO_EMAIL)) || undefined;
  const configurationSet = (await settingsService.getEncryptedSetting(SETTING_SES_CONFIGURATION_SET)) || undefined;

  if (!accessKeyId || !secretAccessKey || !region || !fromEmail) {
    throw new Error('Configuración de Amazon SES incompleta: faltan credenciales, región o remitente.');
  }

  return {
    enabled: true,
    provider: 'ses',
    masterEmails,
    ses: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region,
      fromEmail,
      replyToEmail,
      configurationSet,
    },
  };
}
