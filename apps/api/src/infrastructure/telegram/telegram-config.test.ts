import { describe, it, expect } from 'vitest';
import {
  parseChatIds,
  serializeChatIds,
  maskChatId,
  loadTelegramConfig,
  saveTelegramConfig,
  maskTelegramConfig,
} from './telegram-config.js';
import { EncryptedSettingsService } from '../security/encrypted-settings.js';
import { MemorySystemSettingsRepository } from '../fixtures/memory-system-settings-repository.js';

describe('telegram-config', () => {
  it('parses chat IDs from multiple formats and ignores invalid/empty items', () => {
    expect(parseChatIds('12345, -100987654321, \n 55555')).toEqual([
      '12345',
      '-100987654321',
      '55555',
    ]);
    expect(parseChatIds('["123", "-456"]')).toEqual(['123', '-456']);
    expect(parseChatIds('abc, 1234, @bad_chat')).toEqual(['1234']);
  });

  it('serializes and validates chat IDs', () => {
    expect(serializeChatIds(['123', '-100456'])).toBe('["123","-100456"]');
    expect(() => serializeChatIds(['invalid-chat-id'])).toThrow('Identificador de chat de Telegram inválido');
  });

  it('masks chat IDs properly', () => {
    expect(maskChatId('123456789')).toBe('12****89');
    expect(maskChatId('-100123456789')).toBe('-1****89');
    expect(maskChatId('123')).toBe('****');
  });

  it('loads and saves encrypted telegram config without exposing plaintext', async () => {
    const repo = new MemorySystemSettingsRepository();
    const service = new EncryptedSettingsService(repo, 'a'.repeat(64));

    await saveTelegramConfig(service, {
      enabled: true,
      botToken: '123456:ABC-DEF_ghi',
      chatIds: ['10000001', '10000002'],
    });

    const loaded = await loadTelegramConfig(service);
    expect(loaded.enabled).toBe(true);
    expect(loaded.botToken).toBe('123456:ABC-DEF_ghi');
    expect(loaded.chatIds).toEqual(['10000001', '10000002']);

    const masked = maskTelegramConfig(loaded);
    expect(masked.enabled).toBe(true);
    expect(masked.hasToken).toBe(true);
    expect(masked.chatIdsCount).toBe(2);
    expect(masked.maskedChatIds).toEqual(['10****01', '10****02']);

    // Ensure raw setting in repository is encrypted
    const rawToken = await repo.getSetting('telegram_bot_token');
    expect(rawToken).toMatch(/^enc:v1:/);
  });
});
