import { describe, expect, it } from 'vitest';
import { EncryptedSettingsService } from './encrypted-settings.js';
import { MemorySystemSettingsRepository } from '../fixtures/memory-system-settings-repository.js';

describe('EncryptedSettingsService', () => {
  const testMasterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('encrypts and decrypts text successfully (round-trip)', () => {
    const repo = new MemorySystemSettingsRepository();
    const service = new EncryptedSettingsService(repo, testMasterKey);

    const plaintext = 'AKIAIOSFODNN7EXAMPLE';
    const ciphertext = service.encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.startsWith('enc:v1:')).toBe(true);

    const decrypted = service.decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext across two calls (distinct nonces)', () => {
    const repo = new MemorySystemSettingsRepository();
    const service = new EncryptedSettingsService(repo, testMasterKey);

    const plaintext = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const ciphertext1 = service.encrypt(plaintext);
    const ciphertext2 = service.encrypt(plaintext);

    expect(ciphertext1).not.toBe(ciphertext2);
    expect(service.decrypt(ciphertext1)).toBe(plaintext);
    expect(service.decrypt(ciphertext2)).toBe(plaintext);
  });

  it('rejects tampered ciphertext, iv, or auth tag', () => {
    const repo = new MemorySystemSettingsRepository();
    const service = new EncryptedSettingsService(repo, testMasterKey);

    const ciphertext = service.encrypt('super-secret-aws-token');
    const parts = ciphertext.split(':');
    expect(parts.length).toBe(5); // ['enc', 'v1', iv, tag, data]

    // Corrupt ciphertext body
    const dataFirstByte = parts[4]!.slice(0, 2);
    const flippedData = dataFirstByte === 'aa' ? 'bb' : 'aa';
    const corruptedData = [...parts.slice(0, 4), flippedData + parts[4]!.slice(2)].join(':');
    expect(() => service.decrypt(corruptedData)).toThrow();

    // Corrupt auth tag
    const tagFirstByte = parts[3]!.slice(0, 2);
    const flippedTag = tagFirstByte === 'aa' ? 'bb' : 'aa';
    const corruptedTag = [parts[0], parts[1], parts[2], flippedTag + parts[3]!.slice(2), parts[4]].join(':');
    expect(() => service.decrypt(corruptedTag)).toThrow();

    // Corrupt IV
    const ivFirstByte = parts[2]!.slice(0, 2);
    const flippedIv = ivFirstByte === 'aa' ? 'bb' : 'aa';
    const corruptedIv = [parts[0], parts[1], flippedIv + parts[2]!.slice(2), parts[3], parts[4]].join(':');
    expect(() => service.decrypt(corruptedIv)).toThrow();
  });

  it('rejects encryption and decryption when master key is absent or empty', () => {
    const repo = new MemorySystemSettingsRepository();
    const serviceWithoutKey = new EncryptedSettingsService(repo, '');

    expect(() => serviceWithoutKey.encrypt('test')).toThrow(/APP_SETTINGS_ENCRYPTION_KEY/);
    expect(() => serviceWithoutKey.decrypt('enc:v1:00:00:00')).toThrow(/APP_SETTINGS_ENCRYPTION_KEY/);

    const serviceUndefined = new EncryptedSettingsService(repo, undefined);
    expect(() => serviceUndefined.encrypt('test')).toThrow(/APP_SETTINGS_ENCRYPTION_KEY/);
  });

  it('verifies that the stored repository value does NOT contain the plaintext', async () => {
    const repo = new MemorySystemSettingsRepository();
    const service = new EncryptedSettingsService(repo, testMasterKey);

    const secretValue = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    await service.setEncryptedSetting('ses_aws_secret_access_key', secretValue, 'admin@flacso.edu.uy');

    const storedRaw = await repo.getSetting('ses_aws_secret_access_key');
    expect(storedRaw).not.toBeNull();
    expect(storedRaw).not.toContain(secretValue);
    expect(storedRaw!.startsWith('enc:v1:')).toBe(true);

    const decrypted = await service.getEncryptedSetting('ses_aws_secret_access_key');
    expect(decrypted).toBe(secretValue);
  });

  it('returns null when getting a non-existent encrypted setting', async () => {
    const repo = new MemorySystemSettingsRepository();
    const service = new EncryptedSettingsService(repo, testMasterKey);

    const result = await service.getEncryptedSetting('non_existent_key');
    expect(result).toBeNull();
  });

  describe('master key strength', () => {
    it('refuses the public placeholder from .env.example', () => {
      const service = new EncryptedSettingsService(
        new MemorySystemSettingsRepository(),
        'REEMPLAZAR_CON_CLAVE_LOCAL_HEX_64_CHARS',
      );
      expect(() => service.encrypt('secreto')).toThrow(/no es segura/);
    });

    it('refuses short passphrases but still accepts a long one for backwards compatibility', () => {
      const repo = new MemorySystemSettingsRepository();
      expect(() => new EncryptedSettingsService(repo, 'corta').encrypt('x')).toThrow(/no es segura/);

      const longPassphrase = 'una-frase-larga-y-aleatoria-de-mas-de-32-caracteres';
      const service = new EncryptedSettingsService(repo, longPassphrase);
      expect(service.decrypt(service.encrypt('secreto'))).toBe('secreto');
    });
  });
});
