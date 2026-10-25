import { describe, expect, it, vi } from 'vitest';
import { EmailProviderError } from './email-provider.js';
import { MauticEmailProvider } from './mautic-email-provider.js';
import { MauticError, type MauticClient } from '../mautic/mautic-client.js';

function fakeClient(overrides: Partial<Record<keyof MauticClient, unknown>> = {}) {
  return {
    verify: vi.fn(async () => undefined),
    upsertContact: vi.fn(async () => 31),
    sendTemplateEmail: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MauticClient & {
    upsertContact: ReturnType<typeof vi.fn>;
    sendTemplateEmail: ReturnType<typeof vi.fn>;
  };
}

const message = {
  to: ['postulante@example.com'],
  subject: 'Recibimos tu preinscripción',
  text: 'Texto plano',
  html: '<!DOCTYPE html><html><head></head><body style="x"><h1>Hola</h1></body></html>',
  tags: { submissionId: 'sub_1', targetId: 't1', audience: 'applicant' },
};

describe('MauticEmailProvider', () => {
  it('sends the applicant template with the message as tokens', async () => {
    const client = fakeClient();
    const result = await new MauticEmailProvider(client, { applicantTemplateId: 11, teamTemplateId: 12 }).send(message);

    expect(client.upsertContact).toHaveBeenCalledWith('postulante@example.com');
    expect(client.sendTemplateEmail).toHaveBeenCalledWith(11, 31, {
      '{preinscripcion_asunto}': 'Recibimos tu preinscripción',
      '{preinscripcion_contenido}': '<h1>Hola</h1>',
      '{preinscripcion_texto}': 'Texto plano',
      '{preinscripcion_id}': 'sub_1',
    });
    expect(result.providerMessageId).toBe('mautic:11:31');
  });

  it.each(['target', 'master'])('uses the team template for the %s audience', async (audience) => {
    const client = fakeClient();
    await new MauticEmailProvider(client, { applicantTemplateId: 11, teamTemplateId: 12 })
      .send({ ...message, to: ['coordinacion@flacso.edu.uy'], tags: { ...message.tags, audience } });

    expect(client.sendTemplateEmail.mock.calls[0]![0]).toBe(12);
  });

  it('keeps the Mautic error classification for the dispatcher', async () => {
    const client = fakeClient({
      sendTemplateEmail: vi.fn(async () => { throw new MauticError('timeout', 'unknown'); }),
    });

    await expect(new MauticEmailProvider(client, { applicantTemplateId: 11, teamTemplateId: 12 }).send(message))
      .rejects.toEqual(expect.objectContaining({ name: 'EmailProviderError', classification: 'unknown' }));
    await expect(new MauticEmailProvider(client, { applicantTemplateId: 11, teamTemplateId: 12 }).send(message))
      .rejects.toBeInstanceOf(EmailProviderError);
  });
});
