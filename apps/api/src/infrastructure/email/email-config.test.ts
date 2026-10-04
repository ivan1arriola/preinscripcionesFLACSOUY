import { describe, expect, it } from 'vitest';
import {
  parseMasterEmails,
  serializeMasterEmails,
  loadEmailConfig,
  SETTING_EMAIL_NOTIFICATIONS_ENABLED,
  SETTING_NOTIFICATION_MASTER_EMAILS,
  SETTING_SES_AWS_ACCESS_KEY_ID,
  SETTING_SES_AWS_SECRET_ACCESS_KEY,
  SETTING_SES_REGION,
  SETTING_SES_FROM_EMAIL,
} from './email-config.js';
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

  describe('loadEmailConfig', () => {
    it('returns disabled provider when notifications are disabled', async () => {
      const repo = new MemorySystemSettingsRepository();
      const service = new EncryptedSettingsService(repo, masterKey);

      const config = await loadEmailConfig(service);
      expect(config.enabled).toBe(false);
      expect(config.provider).toBe('disabled');
      expect(config.masterEmails).toEqual([]);
    });

    it('supports explicit fake provider in development', async () => {
      const repo = new MemorySystemSettingsRepository();
      const service = new EncryptedSettingsService(repo, masterKey);
      await service.setEncryptedSetting(SETTING_EMAIL_NOTIFICATIONS_ENABLED, 'true');
      await service.setEncryptedSetting(SETTING_NOTIFICATION_MASTER_EMAILS, serializeMasterEmails(['master@flacso.edu.uy']));

      const config = await loadEmailConfig(service, { providerOverride: 'fake' });
      expect(config.enabled).toBe(true);
      expect(config.provider).toBe('fake');
      expect(config.masterEmails).toEqual(['master@flacso.edu.uy']);
      expect(config.ses).toBeUndefined();
    });

    it('fails closed when notifications enabled but APP_SETTINGS_ENCRYPTION_KEY is absent', async () => {
      const repo = new MemorySystemSettingsRepository();
      const serviceWithKey = new EncryptedSettingsService(repo, masterKey);
      await serviceWithKey.setEncryptedSetting(SETTING_EMAIL_NOTIFICATIONS_ENABLED, 'true');

      // Now attempt reading with service without key
      const serviceWithoutKey = new EncryptedSettingsService(repo, '');

      await expect(
        loadEmailConfig(serviceWithoutKey, { isProduction: true })
      ).rejects.toThrow(/APP_SETTINGS_ENCRYPTION_KEY/);
    });

    it('fails when notifications enabled with incomplete SES settings in system_settings', async () => {
      const repo = new MemorySystemSettingsRepository();
      const service = new EncryptedSettingsService(repo, masterKey);
      await service.setEncryptedSetting(SETTING_EMAIL_NOTIFICATIONS_ENABLED, 'true');
      await service.setEncryptedSetting(SETTING_SES_AWS_ACCESS_KEY_ID, 'AKIAIOSFODNN7EXAMPLE');
      // Missing secret key, region, and fromEmail

      await expect(loadEmailConfig(service)).rejects.toThrow(/incompleta/i);
    });

    it('loads complete SES configuration successfully', async () => {
      const repo = new MemorySystemSettingsRepository();
      const service = new EncryptedSettingsService(repo, masterKey);
      await service.setEncryptedSetting(SETTING_EMAIL_NOTIFICATIONS_ENABLED, 'true');
      await service.setEncryptedSetting(SETTING_NOTIFICATION_MASTER_EMAILS, serializeMasterEmails(['master@flacso.edu.uy']));
      await service.setEncryptedSetting(SETTING_SES_AWS_ACCESS_KEY_ID, 'AKIAIOSFODNN7EXAMPLE');
      await service.setEncryptedSetting(SETTING_SES_AWS_SECRET_ACCESS_KEY, 'secret-key-123');
      await service.setEncryptedSetting(SETTING_SES_REGION, 'us-east-1');
      await service.setEncryptedSetting(SETTING_SES_FROM_EMAIL, 'preinscripciones@flacso.edu.uy');

      const config = await loadEmailConfig(service);
      expect(config.enabled).toBe(true);
      expect(config.provider).toBe('ses');
      expect(config.masterEmails).toEqual(['master@flacso.edu.uy']);
      expect(config.ses).toEqual({
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret-key-123',
        sessionToken: undefined,
        region: 'us-east-1',
        fromEmail: 'preinscripciones@flacso.edu.uy',
        replyToEmail: undefined,
        configurationSet: undefined,
      });
    });
  });
});
