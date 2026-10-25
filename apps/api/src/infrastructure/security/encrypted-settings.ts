import crypto from 'node:crypto';
import type { SystemSettingsRepository } from '../../ports/system-settings-repository.js';

export class EncryptedSettingsService {
  constructor(
    private readonly repository: SystemSettingsRepository,
    private readonly masterKey?: string
  ) {}

  private getKeyBuffer(): Buffer {
    if (!this.masterKey || this.masterKey.trim().length === 0) {
      throw new Error('APP_SETTINGS_ENCRYPTION_KEY no está configurada');
    }
    const trimmed = this.masterKey.trim();
    if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    // Una frase se acepta por compatibilidad, pero nunca el valor de ejemplo ni una clave corta: el
    // marcador de .env.example es público y cifraría los secretos con una clave conocida.
    if (/REEMPLAZAR|CAMBIAR|CHANGE_?ME|EXAMPLE/i.test(trimmed) || trimmed.length < 32) {
      throw new Error(
        'APP_SETTINGS_ENCRYPTION_KEY no es segura: usá 64 caracteres hexadecimales (openssl rand -hex 32).'
      );
    }
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
  }

  encrypt(plaintext: string): string {
    const key = this.getKeyBuffer();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    const key = this.getKeyBuffer();
    const parts = ciphertext.split(':');
    if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
      throw new Error('Formato de ciphertext no reconocido');
    }

    const ivHex = parts[2]!;
    const tagHex = parts[3]!;
    const dataHex = parts[4]!;

    try {
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(tagHex, 'hex');
      const encryptedData = Buffer.from(dataHex, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error(
        `No se pudo descifrar el valor configurado (clave inválida o datos alterados): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async getEncryptedSetting(key: string): Promise<string | null> {
    const raw = await this.repository.getSetting(key);
    if (raw === null || raw === undefined) {
      return null;
    }
    if (raw.startsWith('enc:v1:')) {
      return this.decrypt(raw);
    }
    return raw;
  }

  async setEncryptedSetting(key: string, plaintext: string, updatedBy?: string): Promise<void> {
    const encrypted = this.encrypt(plaintext);
    await this.repository.setSetting(key, encrypted, updatedBy);
  }
}
