import { describe, expect, it, vi } from 'vitest';
import { MAX_NOTIFY_ATTEMPTS, notifyEnrollment, type EnrollmentSender } from './mautic-enrollment-notify-dispatcher.js';
import { signMauticEnrollment } from '../domain/mautic-enrollment.js';

const webhook = { url: 'https://envios.flacso.edu.uy/flacso/enrollments', secret: 's'.repeat(32) };
const payload = JSON.stringify({ email: 'valeria@example.com', offerWpId: 24162 });
const NOW = 1_800_000_000_000;

function sender(result: number | Error) {
  return vi.fn<EnrollmentSender>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
}

describe('notifyEnrollment', () => {
  it('posts the eventId, email and offer signed like the Mautic plugin expects', async () => {
    const send = sender(200);
    await expect(notifyEnrollment('evt-1', payload, webhook, send, 1, NOW)).resolves.toEqual({ status: 'notified' });

    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe(webhook.url);
    expect(JSON.parse(init.body)).toEqual({ eventId: 'evt-1', email: 'valeria@example.com', offerWpId: 24162 });
    expect(init.headers['X-Flacso-Timestamp']).toBe('1800000000');
    expect(init.headers['X-Flacso-Signature']).toBe(signMauticEnrollment(webhook.secret, '1800000000', init.body));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it.each([
    ['network failure', new Error('ECONNRESET'), 'mautic_unavailable'],
    ['5xx', 502, 'mautic_http_502'],
    ['401 (signature or clock skew)', 401, 'mautic_http_401'],
    ['409 (contact not yet available)', 409, 'mautic_http_409'],
    ['503 (secret not configured in Mautic yet)', 503, 'mautic_http_503'],
  ])('retries on %s', async (_label, result, safeCode) => {
    await expect(notifyEnrollment('evt-1', payload, webhook, sender(result), 1, NOW)).resolves.toEqual({ status: 'retry', safeCode });
  });

  it('fails permanently when Mautic rejects the data', async () => {
    await expect(notifyEnrollment('evt-1', payload, webhook, sender(422), 1, NOW))
      .resolves.toEqual({ status: 'failed', safeCode: 'mautic_http_422' });
  });

  it('gives up after the maximum number of attempts', async () => {
    await expect(notifyEnrollment('evt-1', payload, webhook, sender(502), MAX_NOTIFY_ATTEMPTS, NOW))
      .resolves.toEqual({ status: 'failed', safeCode: 'mautic_http_502' });
    await expect(notifyEnrollment('evt-1', payload, webhook, sender(new Error('down')), MAX_NOTIFY_ATTEMPTS, NOW))
      .resolves.toEqual({ status: 'failed', safeCode: 'mautic_unavailable' });
  });

  it('fails without calling Mautic on an invalid payload', async () => {
    const send = sender(200);
    await expect(notifyEnrollment('evt-1', '{bad', webhook, send, 1, NOW)).resolves.toEqual({ status: 'failed', safeCode: 'invalid_payload' });
    await expect(notifyEnrollment('evt-1', '{}', webhook, send, 1, NOW)).resolves.toEqual({ status: 'failed', safeCode: 'invalid_payload' });
    expect(send).not.toHaveBeenCalled();
  });
});
