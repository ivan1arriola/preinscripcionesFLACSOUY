import { describe, expect, it, vi } from 'vitest';
import { FakeEmailProvider } from './email-provider.js';
import {
  SmtpEmailProvider,
  type SmtpTransport,
  smtpTransportOptions,
} from './smtp-email-provider.js';

const smtpConfig = {
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 587,
  security: 'starttls' as const,
  username: 'smtp-user',
  password: 'smtp-password',
  fromEmail: 'preinscripciones@flacso.edu.uy',
  replyToEmail: 'consultas@flacso.edu.uy',
};

function transport(): SmtpTransport {
  return {
    verify: vi.fn().mockResolvedValue(undefined),
    sendMail: vi.fn().mockResolvedValue({ messageId: 'smtp-message-123' }),
  };
}

describe('SmtpEmailProvider', () => {
  it('lets the fake provider verify without sending a message', async () => {
    const provider = new FakeEmailProvider();

    await expect(provider.verify()).resolves.toBeUndefined();
    expect(provider.sentMessages).toEqual([]);
  });

  it('verifies SMTP authentication without sending a message', async () => {
    const injectedTransport = transport();
    const provider = new SmtpEmailProvider(smtpConfig, injectedTransport);

    await provider.verify();

    expect(injectedTransport.verify).toHaveBeenCalledOnce();
    expect(injectedTransport.sendMail).not.toHaveBeenCalled();
  });

  it('maps sender, reply-to, bodies, and tags to the injected SMTP transport', async () => {
    const injectedTransport = transport();
    const provider = new SmtpEmailProvider(smtpConfig, injectedTransport);

    await expect(
      provider.send({
        to: ['postulante@example.com'],
        subject: 'Confirmación de preinscripción',
        text: 'Recibimos su preinscripción.',
        html: '<p>Recibimos su preinscripción.</p>',
        replyTo: ['coordinacion@flacso.edu.uy'],
        tags: { audience: 'applicant', submissionId: 'sub_123' },
      })
    ).resolves.toEqual({ providerMessageId: 'smtp-message-123' });

    expect(injectedTransport.sendMail).toHaveBeenCalledWith({
      from: 'preinscripciones@flacso.edu.uy',
      to: ['postulante@example.com'],
      subject: 'Confirmación de preinscripción',
      text: 'Recibimos su preinscripción.',
      html: '<p>Recibimos su preinscripción.</p>',
      replyTo: ['coordinacion@flacso.edu.uy'],
      headers: { 'X-FLACSO-Notification-Tags': 'audience=applicant,submissionId=sub_123' },
    });
  });

  it('uses the configured reply-to when the message has none', async () => {
    const injectedTransport = transport();
    const provider = new SmtpEmailProvider(smtpConfig, injectedTransport);

    await provider.send({
      to: ['postulante@example.com'],
      subject: 'Confirmación',
      text: 'Texto',
      html: '<p>Texto</p>',
    });

    expect(injectedTransport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: ['consultas@flacso.edu.uy'] })
    );
  });

  it.each([
    [{ responseCode: 451, command: 'MAIL FROM' }, 'retryable'],
    [{ responseCode: 550, command: 'RCPT TO' }, 'permanent'],
    [{ code: 'ETIMEDOUT', command: 'DATA' }, 'unknown'],
  ] as const)('classifies SMTP errors as %s', async (smtpError, classification) => {
    const injectedTransport = transport();
    (injectedTransport.sendMail as ReturnType<typeof vi.fn>).mockRejectedValue(smtpError);
    const provider = new SmtpEmailProvider(smtpConfig, injectedTransport);

    await expect(
      provider.send({
        to: ['postulante@example.com'],
        subject: 'Confirmación',
        text: 'Texto privado',
        html: '<p>Texto privado</p>',
      })
    ).rejects.toMatchObject({ classification });
  });

  it('keeps ambiguous transport outcomes unknown and never marks them retryable', async () => {
    const injectedTransport = transport();
    (injectedTransport.sendMail as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: 'ECONNRESET',
      command: 'DATA',
    });
    const provider = new SmtpEmailProvider(smtpConfig, injectedTransport);

    await expect(
      provider.send({
        to: ['postulante@example.com'],
        subject: 'Confirmación',
        text: 'Texto',
        html: '<p>Texto</p>',
      })
    ).rejects.toMatchObject({ classification: 'unknown' });
  });

  it('rejects invalid recipients before invoking the transport', async () => {
    const injectedTransport = transport();
    const provider = new SmtpEmailProvider(smtpConfig, injectedTransport);

    await expect(
      provider.send({
        to: ['not-an-email'],
        subject: 'Confirmación',
        text: 'Texto',
        html: '<p>Texto</p>',
      })
    ).rejects.toMatchObject({ classification: 'permanent' });

    expect(injectedTransport.sendMail).not.toHaveBeenCalled();
  });

  it('uses STARTTLS or direct TLS transport options without connecting', () => {
    expect(smtpTransportOptions(smtpConfig)).toEqual({
      host: 'email-smtp.us-east-1.amazonaws.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'smtp-user', pass: 'smtp-password' },
    });
    expect(smtpTransportOptions({ ...smtpConfig, port: 465, security: 'tls' })).toEqual({
      host: 'email-smtp.us-east-1.amazonaws.com',
      port: 465,
      secure: true,
      auth: { user: 'smtp-user', pass: 'smtp-password' },
    });
  });
});
