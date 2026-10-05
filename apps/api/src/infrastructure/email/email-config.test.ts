import { describe, expect, it } from 'vitest';
import {
  invalidateSmtpVerificationStatus,
  parseMasterEmails,
  safeSmtpVerificationError,
  serializeMasterEmails,
  loadEmailConfig,
  smtpSettingsRequireReverification,
  maskEmail,
  isMaskedEmail,
  isValidEmailOrMasked,
  SETTING_EMAIL_NOTIFICATIONS_ENABLED,
  SETTING_NOTIFICATION_MASTER_EMAILS,
} from './email-config.js';
import { EmailProviderError } from './email-provider.js';
import { EncryptedSettingsService } from '../security/encrypted-settings.js';
import { MemorySystemSettingsRepository } from '../fixtures/memory-system-settings-repository.js';

describe('email-config', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  describe('parseMasterEmails and serializeMasterEmails', () => {
    it('normalizes, deduplicates, and filters valid emails from comma/newline strings and JSON arrays', () => {
      const rawText = ' Admin@flacso.edu.uy , WEB@FLACSO.EDU.UY\nadmin@flacso.edu.uy; not-an-email \n';
      const parsed = parseMasterEmails(rawText);
      expect(parsed).toEqual(['admin@flacso.edu.uy', 'web@flacso.edu.uy']);

      const jsonRaw = JSON.stringify(['coordinacion@flacso.edu.uy', ' ADMIN@flacso.edu.uy ']);
      expect(parseMasterEmails(jsonRaw)).toEqual(['coordinacion@flacso.edu.uy', 'admin@flacso.edu.uy']);
    });

    it('returns empty array on empty or null input', () => {
      expect(parseMasterEmails(null)).toEqual([]);
      expect(parseMasterEmails('')).toEqual([]);
      expect(parseMasterEmails(undefined)).toEqual([]);
    });

    it('serializes valid emails and rejects invalid ones', () => {
      const serialized = serializeMasterEmails(['  Admin@flacso.edu.uy ', 'info@flacso.edu.uy']);
      expect(JSON.parse(serialized)).toEqual(['admin@flacso.edu.uy', 'info@flacso.edu.uy']);

      expect(() => serializeMasterEmails(['bad-email'])).toThrow(/inválido/);
    });
  });

  describe('masking and validation helpers', () => {
    it('masks emails correctly according to local-part length', () => {
      expect(maskEmail('a@flacso.edu.uy')).toBe('a***@flacso.edu.uy');
      expect(maskEmail('ab@flacso.edu.uy')).toBe('a***@flacso.edu.uy');
      expect(maskEmail('notificaciones@flacso.edu.uy')).toBe('no***s@flacso.edu.uy');
      expect(maskEmail('invalid')).toBe('***');
    });

    it('identifies masked email strings', () => {
      expect(isMaskedEmail('no***s@flacso.edu.uy')).toBe(true);
      expect(isMaskedEmail('***')).toBe(true);
      expect(isMaskedEmail('real@flacso.edu.uy')).toBe(false);
    });

    it('validates plain and masked email strings', () => {
      expect(isValidEmailOrMasked('valid@flacso.edu.uy')).toBe(true);
      expect(isValidEmailOrMasked('no***s@flacso.edu.uy')).toBe(true);
      expect(isValidEmailOrMasked('invalid-email')).toBe(false);
      expect(isValidEmailOrMasked('not an email@flacso')).toBe(false);
    });
  });

  describe('loadEmailConfig', () => {
    it('returns disabled provider when notifications are disabled', async () => {
      const repo = new MemorySystemSettingsRepository();
      const service = new EncryptedSettingsService(repo, masterKey);

      const config = await loadEmailConfig(service);
      expect(config.enabled).toBe(false);
      expect(config.provider).toBe('disabled');
      expect(config.masterEmails).toEqual([]);
    });

    it('supports the explicit fake provider only outside production', async () => {
      const repo = new MemorySystemSettingsRepository();
      const service = new EncryptedSettingsService(repo, masterKey);
      await service.setEncryptedSetting(SETTING_EMAIL_NOTIFICATIONS_ENABLED, 'true');
      await service.setEncryptedSetting(SETTING_NOTIFICATION_MASTER_EMAILS, serializeMasterEmails(['master@flacso.edu.uy']));

      const config = await loadEmailConfig(service, { isProduction: false, providerOverride: 'fake' });
      expect(config.enabled).toBe(true);
      expect(config.provider).toBe('fake');
      expect(config.masterEmails).toEqual(['master@flacso.edu.uy']);
      expect(config.smtp).toBeUndefined();
    });

    it('does not activate the fake provider from the operational environment', async () => {
      const previousProvider = process.env.EMAIL_PROVIDER;
      process.env.EMAIL_PROVIDER = 'fake';
      try {
        const { service } = await createCompleteSmtpSettings();

        const config = await loadEmailConfig(service, { isProduction: false });

        expect(config.provider).toBe('smtp');
      } finally {
        if (previousProvider === undefined) {
          delete process.env.EMAIL_PROVIDER;
        } else {
          process.env.EMAIL_PROVIDER = previousProvider;
        }
      }
    });

    it('ignores the fake override in production and resolves SMTP', async () => {
      const { service } = await createCompleteSmtpSettings();

      const config = await loadEmailConfig(service, { isProduction: true, providerOverride: 'fake' });

      expect(config.provider).toBe('smtp');
    });

    it('resolves complete SMTP settings and normalizes host, username, and emails', async () => {
      const { service } = await createCompleteSmtpSettings();

      const config = await loadEmailConfig(service, { isProduction: true });

      expect(config).toEqual({
        enabled: true,
        provider: 'smtp',
        masterEmails: ['master@flacso.edu.uy', 'web@flacso.edu.uy'],
        smtp: {
          host: 'email-smtp.us-east-1.amazonaws.com',
          port: 587,
          security: 'starttls',
          username: 'smtp-user',
          password: 'smtp-secret-password',
          fromEmail: 'preinscripciones@flacso.edu.uy',
          replyToEmail: 'respuestas@flacso.edu.uy',
        },
      });
    });

    it('decrypts the SMTP password only in the resolved in-memory configuration', async () => {
      const { repo, service } = await createCompleteSmtpSettings();
      const storedPassword = await repo.getSetting('smtp_password');

      const config = await loadEmailConfig(service, { isProduction: true });

      expect(storedPassword).toMatch(/^enc:v1:/);
      expect(storedPassword).not.toContain('smtp-secret-password');
      expect(config.smtp?.password).toBe('smtp-secret-password');
    });

    it('keeps notifications effectively disabled when SMTP is incomplete and preserves historical AWS values', async () => {
      const historicalAwsSettings = {
        ses_aws_access_key_id: 'enc:v1:historical-access-key',
        ses_aws_secret_access_key: 'enc:v1:historical-secret-key',
        ses_region: 'us-east-1',
        ses_from_email: 'legacy@flacso.edu.uy',
      };
      const repo = new MemorySystemSettingsRepository({
        email_notifications_enabled: 'true',
        email_provider: 'smtp',
        smtp_host: 'email-smtp.us-east-1.amazonaws.com',
        smtp_port: '587',
        smtp_security: 'starttls',
        ...historicalAwsSettings,
      });
      const service = new EncryptedSettingsService(repo, masterKey);

      const config = await loadEmailConfig(service, { isProduction: true });

      expect(config).toEqual({ enabled: true, provider: 'disabled', masterEmails: [] });
      for (const [key, value] of Object.entries(historicalAwsSettings)) {
        expect(await repo.getSetting(key)).toBe(value);
      }
    });

    it('does not read any historical SES setting while resolving SMTP', async () => {
      const repo = new SesReadRejectingRepository({
        ses_aws_access_key_id: 'historical-access-key',
        ses_aws_secret_access_key: 'historical-secret-key',
        ses_region: 'us-east-1',
        ses_from_email: 'legacy@flacso.edu.uy',
      });
      const { service } = await createCompleteSmtpSettings({}, repo);

      const config = await loadEmailConfig(service, { isProduction: true });

      expect(config.provider).toBe('smtp');
      expect(repo.requestedKeys.filter((key) => key.startsWith('ses_'))).toEqual([]);
    });

    it.each([
      ['host with a protocol', { smtp_host: 'https://email-smtp.us-east-1.amazonaws.com' }],
      ['port outside the valid range', { smtp_port: '65536' }],
      ['unsupported security', { smtp_security: 'ssl' }],
      ['invalid sender', { email_from: 'not-an-email' }],
      ['invalid reply-to', { email_reply_to: 'not-an-email' }],
    ])('does not expose SMTP when %s is stored', async (_case, override) => {
      const { service } = await createCompleteSmtpSettings(override);

      const config = await loadEmailConfig(service, { isProduction: true });

      expect(config.enabled).toBe(true);
      expect(config.provider).toBe('disabled');
      expect(config.smtp).toBeUndefined();
    });

    it('fails safely when an encrypted SMTP password is configured without the encryption key', async () => {
      const encryptedPassword = new EncryptedSettingsService(
        new MemorySystemSettingsRepository(),
        masterKey,
      ).encrypt('smtp-secret-password');
      const repo = new MemorySystemSettingsRepository({
        email_notifications_enabled: 'true',
        email_provider: 'smtp',
        smtp_host: 'email-smtp.us-east-1.amazonaws.com',
        smtp_port: '587',
        smtp_security: 'starttls',
        smtp_username: 'smtp-user',
        smtp_password: encryptedPassword,
        email_from: 'preinscripciones@flacso.edu.uy',
        email_reply_to: '',
      });
      const serviceWithoutKey = new EncryptedSettingsService(repo, '');

      const promise = loadEmailConfig(serviceWithoutKey, { isProduction: true });

      await expect(promise).rejects.toThrow(/APP_SETTINGS_ENCRYPTION_KEY/);
      await expect(promise).rejects.not.toThrow(/smtp-secret-password|enc:v1:/);
    });

    it('reports a safe SMTP configuration failure for corrupted encrypted settings', async () => {
      const { repo, service } = await createCompleteSmtpSettings();
      await repo.setSetting('smtp_password', 'enc:v1:corrupted');

      const promise = loadEmailConfig(service, { isProduction: true });

      await expect(promise).rejects.toThrow(/No se pudo cargar la configuración SMTP/);
      await expect(promise).rejects.not.toThrow(/APP_SETTINGS_ENCRYPTION_KEY|enc:v1:corrupted|smtp-secret-password/);
    });
  });

  describe('SMTP verification state', () => {
    it('requires a new verification when connection fields or the password change', () => {
      for (const key of ['smtp_host', 'smtp_port', 'smtp_security', 'smtp_username', 'smtp_password']) {
        expect(smtpSettingsRequireReverification([key])).toBe(true);
      }
      expect(smtpSettingsRequireReverification(['email_from', 'email_reply_to'])).toBe(false);
    });

    it('invalidates the persisted verification result without retaining its previous message', async () => {
      const repo = new MemorySystemSettingsRepository();
      const service = new EncryptedSettingsService(repo, masterKey);
      await service.setEncryptedSetting('smtp_last_connection_test_at', '2026-10-04T20:00:00.000Z');
      await service.setEncryptedSetting('smtp_last_connection_test_ok', 'false');
      await service.setEncryptedSetting('smtp_last_connection_test_error', 'previous safe error');

      await invalidateSmtpVerificationStatus(service, 'admin@flacso.edu.uy');

      for (const key of [
        'smtp_last_connection_test_at',
        'smtp_last_connection_test_ok',
        'smtp_last_connection_test_error',
      ]) {
        expect(await service.getEncryptedSetting(key)).toBe('');
        const stored = await repo.getSetting(key);
        expect(stored).toMatch(/^enc:v1:/);
        expect(stored).not.toContain('previous safe error');
      }
    });

    it('keeps provider errors bounded and replaces unknown errors with a safe message', () => {
      const providerError = new EmailProviderError(`Error SMTP (${'E'.repeat(300)})`, 'permanent');
      const bounded = safeSmtpVerificationError(providerError);
      const unknown = safeSmtpVerificationError(
        new Error('server rejected smtp-secret-password'),
      );

      expect(bounded.length).toBeLessThanOrEqual(200);
      expect(bounded).toMatch(/^Error SMTP/);
      expect(unknown).toBe('No se pudo verificar la conexión SMTP.');
      expect(unknown).not.toContain('smtp-secret-password');
    });
  });

  async function createCompleteSmtpSettings(
    overrides: Record<string, string> = {},
    repo: MemorySystemSettingsRepository = new MemorySystemSettingsRepository(),
  ) {
    const service = new EncryptedSettingsService(repo, masterKey);
    const values = {
      email_notifications_enabled: 'true',
      notification_master_emails: serializeMasterEmails([
        ' Master@flacso.edu.uy ',
        'WEB@FLACSO.EDU.UY',
        'master@flacso.edu.uy',
      ]),
      email_provider: 'smtp',
      smtp_host: ' EMAIL-SMTP.US-EAST-1.AMAZONAWS.COM ',
      smtp_port: '587',
      smtp_security: 'starttls',
      smtp_username: ' smtp-user ',
      smtp_password: 'smtp-secret-password',
      email_from: ' Preinscripciones@FLACSO.EDU.UY ',
      email_reply_to: ' Respuestas@FLACSO.EDU.UY ',
      ...overrides,
    };

    for (const [key, value] of Object.entries(values)) {
      await service.setEncryptedSetting(key, value);
    }

    return { repo, service };
  }
});

class SesReadRejectingRepository extends MemorySystemSettingsRepository {
  readonly requestedKeys: string[] = [];

  override async getSetting(key: string): Promise<string | null> {
    this.requestedKeys.push(key);
    if (key.startsWith('ses_')) {
      throw new Error('Las claves SES históricas no deben leerse.');
    }
    return super.getSetting(key);
  }
}
