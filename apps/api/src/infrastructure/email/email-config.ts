import type { EncryptedSettingsService } from '../security/encrypted-settings.js';
import { EmailProviderError } from './email-provider.js';

export const SETTING_EMAIL_NOTIFICATIONS_ENABLED = 'email_notifications_enabled';
export const SETTING_NOTIFICATION_MASTER_EMAILS = 'notification_master_emails';
export const SETTING_EMAIL_PROVIDER = 'email_provider';
export const SETTING_SMTP_HOST = 'smtp_host';
export const SETTING_SMTP_PORT = 'smtp_port';
export const SETTING_SMTP_SECURITY = 'smtp_security';
export const SETTING_SMTP_USERNAME = 'smtp_username';
export const SETTING_SMTP_PASSWORD = 'smtp_password';
export const SETTING_EMAIL_FROM = 'email_from';
export const SETTING_EMAIL_REPLY_TO = 'email_reply_to';
export const SETTING_SMTP_LAST_CONNECTION_TEST_AT = 'smtp_last_connection_test_at';
export const SETTING_SMTP_LAST_CONNECTION_TEST_OK = 'smtp_last_connection_test_ok';
export const SETTING_SMTP_LAST_CONNECTION_TEST_ERROR = 'smtp_last_connection_test_error';

const SMTP_CONNECTION_SETTING_KEYS = new Set([
  SETTING_SMTP_HOST,
  SETTING_SMTP_PORT,
  SETTING_SMTP_SECURITY,
  SETTING_SMTP_USERNAME,
  SETTING_SMTP_PASSWORD,
]);

// Legacy exports remain until the runtime and admin routes migrate in later tasks.
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

export function isMaskedEmail(value: string): boolean {
  return value.includes('***');
}

export function isValidEmailOrMasked(value: string): boolean {
  if (isMaskedEmail(value)) return true;
  return EMAIL_REGEX.test(value.trim());
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

export type SmtpSecurity = 'starttls' | 'tls';

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromEmail: string;
  replyToEmail?: string;
}

export interface ResolvedEmailConfig {
  enabled: boolean;
  provider: 'smtp' | 'fake' | 'disabled';
  masterEmails: string[];
  smtp?: SmtpConfig;
}

export interface LoadEmailConfigOptions {
  isProduction?: boolean;
  providerOverride?: string;
}

export function smtpSettingsRequireReverification(changedKeys: Iterable<string>): boolean {
  for (const key of changedKeys) {
    if (SMTP_CONNECTION_SETTING_KEYS.has(key)) return true;
  }
  return false;
}

export async function invalidateSmtpVerificationStatus(
  settingsService: EncryptedSettingsService,
  updatedBy?: string,
): Promise<void> {
  await Promise.all([
    settingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_AT, '', updatedBy),
    settingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_OK, '', updatedBy),
    settingsService.setEncryptedSetting(SETTING_SMTP_LAST_CONNECTION_TEST_ERROR, '', updatedBy),
  ]);
}

export function safeSmtpVerificationError(error: unknown): string {
  if (!(error instanceof EmailProviderError)) {
    return 'No se pudo verificar la conexión SMTP.';
  }
  return `Error SMTP (${error.classification}).`.slice(0, 200);
}

function normalizeEmail(value: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && EMAIL_REGEX.test(normalized) ? normalized : undefined;
}

function normalizeSmtpHost(value: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized.length > 253 || /[:/\s]/.test(normalized)) return undefined;
  const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  return hostnamePattern.test(normalized) ? normalized : undefined;
}

function normalizeSmtpPort(value: string | null): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const port = Number(normalized);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined;
}

function normalizeSmtpSecurity(value: string | null): SmtpSecurity | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'starttls' || normalized === 'tls' ? normalized : undefined;
}

function smtpConfigurationReadError(error: unknown): Error {
  if (error instanceof Error && error.message === 'APP_SETTINGS_ENCRYPTION_KEY no está configurada') {
    return new Error('APP_SETTINGS_ENCRYPTION_KEY es requerida para leer la configuración SMTP cifrada.');
  }
  return new Error('No se pudo cargar la configuración SMTP de forma segura.');
}

async function loadSmtpConfig(settingsService: EncryptedSettingsService): Promise<SmtpConfig | undefined> {
  let values: [
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
  ];
  try {
    values = await Promise.all([
      settingsService.getEncryptedSetting(SETTING_EMAIL_PROVIDER),
      settingsService.getEncryptedSetting(SETTING_SMTP_HOST),
      settingsService.getEncryptedSetting(SETTING_SMTP_PORT),
      settingsService.getEncryptedSetting(SETTING_SMTP_SECURITY),
      settingsService.getEncryptedSetting(SETTING_SMTP_USERNAME),
      settingsService.getEncryptedSetting(SETTING_SMTP_PASSWORD),
      settingsService.getEncryptedSetting(SETTING_EMAIL_FROM),
      settingsService.getEncryptedSetting(SETTING_EMAIL_REPLY_TO),
    ] as const);
  } catch (error) {
    throw smtpConfigurationReadError(error);
  }

  const [provider, rawHost, rawPort, rawSecurity, rawUsername, password, rawFrom, rawReplyTo] = values;
  if (provider?.trim().toLowerCase() !== 'smtp') return undefined;

  const host = normalizeSmtpHost(rawHost);
  const port = normalizeSmtpPort(rawPort);
  const security = normalizeSmtpSecurity(rawSecurity);
  const username = rawUsername?.trim();
  const fromEmail = normalizeEmail(rawFrom);
  const replyToEmail = rawReplyTo?.trim() ? normalizeEmail(rawReplyTo) : undefined;

  if (
    !host
    || !port
    || !security
    || !username
    || !password
    || !fromEmail
    || (rawReplyTo?.trim() && !replyToEmail)
  ) {
    return undefined;
  }

  return {
    host,
    port,
    security,
    username,
    password,
    fromEmail,
    replyToEmail,
  };
}

export async function loadEmailConfig(
  settingsService: EncryptedSettingsService,
  options?: LoadEmailConfigOptions
): Promise<ResolvedEmailConfig> {
  const isProduction = options?.isProduction ?? process.env.NODE_ENV === 'production';
  const providerOverride = options?.providerOverride;

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

  if (!isProduction && providerOverride === 'fake') {
    return {
      enabled: true,
      provider: 'fake',
      masterEmails,
    };
  }

  const smtp = await loadSmtpConfig(settingsService);
  if (!smtp) {
    return {
      enabled: true,
      provider: 'disabled',
      masterEmails,
    };
  }

  return {
    enabled: true,
    provider: 'smtp',
    masterEmails,
    smtp,
  };
}
