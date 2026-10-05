import type { TelegramProvider, TelegramSendResult } from '../../ports/telegram-provider.js';

export interface TelegramProviderOptions {
  timeoutMs?: number;
  apiBaseUrl?: string;
}

export class FetchTelegramProvider implements TelegramProvider {
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly apiBaseUrl: string;

  constructor(token: string, options?: TelegramProviderOptions) {
    const trimmed = (token ?? '').trim();
    if (!trimmed || !/^[0-9]+:[a-zA-Z0-9_\-]+$/.test(trimmed)) {
      throw new Error('Token de Telegram inválido');
    }
    this.token = trimmed;
    this.timeoutMs = options?.timeoutMs ?? 10_000;
    this.apiBaseUrl = options?.apiBaseUrl ?? 'https://api.telegram.org';
  }

  async verify(): Promise<void> {
    const url = `${this.apiBaseUrl}/bot${this.token}/getMe`;
    const data = await this.request(url, { method: 'GET' });
    if (!data?.ok) {
      const desc = data?.description || 'No se pudo verificar el bot de Telegram';
      throw new Error(this.sanitizeError(`Telegram error: ${desc}`));
    }
  }

  async send(message: string, chatId: string): Promise<TelegramSendResult> {
    const trimmedChatId = (chatId ?? '').trim();
    if (!trimmedChatId) {
      throw new Error('Identificador de chat de Telegram inválido');
    }

    const url = `${this.apiBaseUrl}/bot${this.token}/sendMessage`;
    const data = await this.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: trimmedChatId,
        text: message,
      }),
    });

    if (!data?.ok) {
      const desc = data?.description || 'Error al enviar mensaje a Telegram';
      throw new Error(this.sanitizeError(`Telegram error: ${desc}`));
    }

    const messageId = data?.result?.message_id ? String(data.result.message_id) : undefined;
    return { providerMessageId: messageId };
  }

  private async request(url: string, init: RequestInit): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const desc = json?.description || `HTTP ${res.status}`;
        throw new Error(this.sanitizeError(`Telegram error: ${desc}`));
      }
      return json;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Telegram error: Tiempo de espera agotado');
      }
      throw new Error(this.sanitizeError(err.message || 'Error de conexión con Telegram'));
    } finally {
      clearTimeout(timeout);
    }
  }

  private sanitizeError(raw: string): string {
    // Redact bot token
    let sanitized = raw.replace(new RegExp(this.token, 'g'), '[REDACTED_TOKEN]');
    sanitized = sanitized.replace(/\/bot[0-9]+:[a-zA-Z0-9_\-]+/g, '/bot[REDACTED_TOKEN]');
    sanitized = sanitized.replace(/([?&](key|token|secret|password|access_token)=)[^&]+/gi, '$1***');

    // Truncate to maximum length
    if (sanitized.length > 500) {
      sanitized = sanitized.slice(0, 497) + '...';
    }
    return sanitized;
  }
}
