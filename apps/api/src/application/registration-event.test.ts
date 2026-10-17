import { describe, expect, it } from 'vitest';
import { buildRegistrationStatusChangedEvent, signFlacsoWebhook } from './registration-event.js';

describe('registration status event contract', () => {
  it('builds a stable idempotent payload with targetId and normalized email', () => {
    expect(buildRegistrationStatusChangedEvent({
      submissionId: 'sub_123',
      targetId: 'target_davia_c11',
      email: '  Postulante@Ejemplo.edu.uy ',
      occurredAt: new Date('2026-10-18T11:40:00.000Z'),
    })).toEqual({
      event_type: 'registration.status.changed',
      idempotency_key: 'preinsc_sub_123',
      occurred_at: '2026-10-18T11:40:00.000Z',
      data: {
        submission_id: 'sub_123',
        email: 'postulante@ejemplo.edu.uy',
        target_id: 'target_davia_c11',
        status: 'effective_submitted',
      },
    });
  });

  it('signs the exact timestamp and serialized body', () => {
    const body = JSON.stringify({ event_type: 'registration.status.changed' });
    const signed = signFlacsoWebhook(body, 'test-secret', 1_800_000_000);
    expect(signed.timestamp).toBe('1800000000');
    expect(signed.signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(signFlacsoWebhook(body, 'test-secret', 1_800_000_000)).toEqual(signed);
    expect(signFlacsoWebhook(`${body} `, 'test-secret', 1_800_000_000).signature).not.toBe(signed.signature);
  });
});
