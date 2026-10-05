import type { EncryptedSettingsService } from '../security/encrypted-settings.js';

export const SETTING_TELEGRAM_RECOVERY_ENABLED = 'telegram_recovery_enabled';
export const SETTING_TELEGRAM_PREINSCRIPTION_ENABLED = 'telegram_preinscription_enabled';
export const SETTING_TELEGRAM_BOT_TOKEN = 'telegram_bot_token';
export const SETTING_TELEGRAM_CHAT_IDS = 'telegram_chat_ids';
export const SETTING_TELEGRAM_LAST_TESTED_AT = 'telegram_last_tested_at';
export const SETTING_TELEGRAM_LAST_TEST_STATUS = 'telegram_last_test_status';
export const SETTING_TELEGRAM_LAST_TEST_ERROR = 'telegram_last_test_error';
export const SETTING_TELEGRAM_LAST_ALERT_SENT_AT = 'telegram_last_alert_sent_at';

export function parseChatIds(raw: string | null | undefined): string[] {
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
    const trimmed = item.trim();
    if (trimmed.length > 0 && /^-?[0-9]+$/.test(trimmed)) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique);
}

export function serializeChatIds(chatIds: string[]): string {
  const unique = new Set<string>();
  for (const id of chatIds) {
    const trimmed = id.trim();
    if (trimmed.length > 0) {
      if (!/^-?[0-9]+$/.test(trimmed)) {
        throw new Error(`Identificador de chat de Telegram inválido: ${id}`);
      }
      unique.add(trimmed);
    }
  }
  return JSON.stringify(Array.from(unique));
}

export function maskChatId(chatId: string): string {
  const trimmed = chatId.trim();
  if (trimmed.length <= 4) return '****';
  return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
}

export interface TelegramConfig {
  enabled: boolean;
  preinscriptionEnabled: boolean;
  botToken: string;
  chatIds: string[];
  lastTestedAt?: string | null;
  lastTestStatus?: 'ok' | 'error' | null;
  lastTestError?: string | null;
  lastAlertSentAt?: string | null;
}

export interface MaskedTelegramConfig {
  enabled: boolean;
  preinscriptionEnabled: boolean;
  hasToken: boolean;
  chatIdsCount: number;
  maskedChatIds: string[];
  lastTestedAt?: string | null;
  lastTestStatus?: 'ok' | 'error' | null;
  lastTestError?: string | null;
  lastAlertSentAt?: string | null;
}

export async function loadTelegramConfig(
  service: EncryptedSettingsService
): Promise<TelegramConfig> {
  const enabledRaw = await service.getEncryptedSetting(SETTING_TELEGRAM_RECOVERY_ENABLED);
  const preinscriptionEnabledRaw = await service.getEncryptedSetting(SETTING_TELEGRAM_PREINSCRIPTION_ENABLED);
  const botToken = (await service.getEncryptedSetting(SETTING_TELEGRAM_BOT_TOKEN)) ?? '';
  const rawChatIds = await service.getEncryptedSetting(SETTING_TELEGRAM_CHAT_IDS);
  const chatIds = parseChatIds(rawChatIds);

  const lastTestedAt = await service.getEncryptedSetting(SETTING_TELEGRAM_LAST_TESTED_AT);
  const lastTestStatus = (await service.getEncryptedSetting(
    SETTING_TELEGRAM_LAST_TEST_STATUS
  )) as 'ok' | 'error' | null;
  const lastTestError = await service.getEncryptedSetting(SETTING_TELEGRAM_LAST_TEST_ERROR);
  const lastAlertSentAt = await service.getEncryptedSetting(SETTING_TELEGRAM_LAST_ALERT_SENT_AT);

  return {
    enabled: enabledRaw === 'true',
    preinscriptionEnabled: preinscriptionEnabledRaw === 'true',
    botToken,
    chatIds,
    lastTestedAt,
    lastTestStatus,
    lastTestError,
    lastAlertSentAt,
  };
}

export async function saveTelegramConfig(
  service: EncryptedSettingsService,
  input: {
    enabled?: boolean;
    preinscriptionEnabled?: boolean;
    botToken?: string;
    chatIds?: string[];
  },
  updatedBy?: string
): Promise<void> {
  if (input.enabled !== undefined) {
    await service.setEncryptedSetting(
      SETTING_TELEGRAM_RECOVERY_ENABLED,
      input.enabled ? 'true' : 'false',
      updatedBy
    );
  }

  if (input.preinscriptionEnabled !== undefined) {
    await service.setEncryptedSetting(
      SETTING_TELEGRAM_PREINSCRIPTION_ENABLED,
      input.preinscriptionEnabled ? 'true' : 'false',
      updatedBy
    );
  }

  if (input.botToken !== undefined && input.botToken.trim().length > 0) {
    const trimmed = input.botToken.trim();
    if (!/^[0-9]+:[a-zA-Z0-9_\-]+$/.test(trimmed)) {
      throw new Error('Token de Telegram inválido');
    }
    await service.setEncryptedSetting(SETTING_TELEGRAM_BOT_TOKEN, trimmed, updatedBy);
  }

  if (input.chatIds !== undefined) {
    const serialized = serializeChatIds(input.chatIds);
    await service.setEncryptedSetting(SETTING_TELEGRAM_CHAT_IDS, serialized, updatedBy);
  }
}

export function maskTelegramConfig(config: TelegramConfig): MaskedTelegramConfig {
  return {
    enabled: config.enabled,
    preinscriptionEnabled: config.preinscriptionEnabled,
    hasToken: config.botToken.length > 0,
    chatIdsCount: config.chatIds.length,
    maskedChatIds: config.chatIds.map(maskChatId),
    lastTestedAt: config.lastTestedAt,
    lastTestStatus: config.lastTestStatus,
    lastTestError: config.lastTestError,
    lastAlertSentAt: config.lastAlertSentAt,
  };
}
