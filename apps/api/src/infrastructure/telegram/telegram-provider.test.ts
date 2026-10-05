import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchTelegramProvider } from './telegram-provider.js';

describe('FetchTelegramProvider', () => {
  const secretToken = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects malformed token before network call', () => {
    expect(() => new FetchTelegramProvider('')).toThrow('Token de Telegram inválido');
    expect(() => new FetchTelegramProvider('invalid token with spaces')).toThrow('Token de Telegram inválido');
  });

  it('verifies bot successfully when getMe returns ok: true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { id: 123, is_bot: true, username: 'test_bot' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const provider = new FetchTelegramProvider(secretToken);
    await expect(provider.verify()).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(callUrl).toContain('https://api.telegram.org/bot');
    expect(callUrl).toContain('/getMe');
  });

  it('throws sanitized error on verify failure without exposing token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const provider = new FetchTelegramProvider(secretToken);
    await expect(provider.verify()).rejects.toThrow('Telegram error: Unauthorized');
    try {
      await provider.verify();
    } catch (err: any) {
      expect(err.message).not.toContain(secretToken);
    }
  });

  it('sends message successfully and returns provider message id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: 45678 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const provider = new FetchTelegramProvider(secretToken);
    const result = await provider.send('Alerta de prueba', '-100123456789');

    expect(result.providerMessageId).toBe('45678');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain('/sendMessage');
    const body = JSON.parse(init?.body as string);
    expect(body.chat_id).toBe('-100123456789');
    expect(body.text).toBe('Alerta de prueba');
  });

  it('throws sanitized error on non-2xx response without leaking token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const provider = new FetchTelegramProvider(secretToken);
    await expect(provider.send('Alerta', '99999')).rejects.toThrow('Telegram error: Forbidden: bot was blocked by the user');
    try {
      await provider.send('Alerta', '99999');
    } catch (err: any) {
      expect(err.message).not.toContain(secretToken);
    }
  });

  it('handles and sanitizes network timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const provider = new FetchTelegramProvider(secretToken, { timeoutMs: 50 });
    await expect(provider.send('Alerta', '99999')).rejects.toThrow('Telegram error: Tiempo de espera agotado');
  });

  it('truncates excessively long provider error messages', async () => {
    const longError = 'A'.repeat(1000);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 500, description: longError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const provider = new FetchTelegramProvider(secretToken);
    try {
      await provider.send('Alerta', '99999');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message.length).toBeLessThan(600);
      expect(err.message).toContain('...');
    }
  });
});
