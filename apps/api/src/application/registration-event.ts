import { createHmac } from 'node:crypto';

export interface RegistrationStatusChangedEvent {
  event_type: 'registration.status.changed';
  idempotency_key: string;
  occurred_at: string;
  data: {
    submission_id: string;
    email: string;
    target_id: string;
    status: 'effective_submitted';
  };
}

export function buildRegistrationStatusChangedEvent(input: {
  submissionId: string;
  targetId: string;
  email: string;
  occurredAt: Date;
}): RegistrationStatusChangedEvent {
  return {
    event_type: 'registration.status.changed',
    idempotency_key: `preinsc_${input.submissionId}`,
    occurred_at: input.occurredAt.toISOString(),
    data: {
      submission_id: input.submissionId,
      email: input.email.trim().toLowerCase(),
      target_id: input.targetId.trim(),
      status: 'effective_submitted',
    },
  };
}

export function signFlacsoWebhook(body: string, secret: string, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const timestamp = String(timestampSeconds);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { timestamp, signature: `sha256=${signature}` };
}
