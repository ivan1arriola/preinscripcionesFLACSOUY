import { describe, expect, it, vi } from 'vitest';
import { SesEmailProvider, SesEmailProviderError } from './ses-client.js';
import type { SesCredentialsConfig } from './email-config.js';

describe('SesEmailProvider', () => {
  const baseConfig: SesCredentialsConfig = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    fromEmail: 'preinscripciones@flacso.edu.uy',
    replyToEmail: 'consultas@flacso.edu.uy',
    configurationSet: 'flacso-notifications-config',
  };

  it('implements verification without sending through SES', async () => {
    const mockClient = { send: vi.fn() } as any;
    const provider = new SesEmailProvider(baseConfig, mockClient);

    await expect(provider.verify()).resolves.toBeUndefined();
    expect(mockClient.send).not.toHaveBeenCalled();
  });

  it('rejects sending when recipients list is empty before calling AWS', async () => {
    const mockClient = { send: vi.fn() } as any;
    const provider = new SesEmailProvider(baseConfig, mockClient);

    await expect(
      provider.send({
        to: [],
        subject: 'Test',
        text: 'Hello',
        html: '<p>Hello</p>',
        tags: {},
      })
    ).rejects.toThrow(/vacíos/i);

    expect(mockClient.send).not.toHaveBeenCalled();
  });

  it('rejects sending when any recipient has invalid email format before calling AWS', async () => {
    const mockClient = { send: vi.fn() } as any;
    const provider = new SesEmailProvider(baseConfig, mockClient);

    await expect(
      provider.send({
        to: ['valid@flacso.edu.uy', 'invalid-email-address'],
        subject: 'Test',
        text: 'Hello',
        html: '<p>Hello</p>',
        tags: {},
      })
    ).rejects.toThrow(/inválido/i);

    expect(mockClient.send).not.toHaveBeenCalled();
  });

  it('successfully translates and sends email with all SES parameters', async () => {
    const mockClient = {
      send: vi.fn().mockResolvedValue({
        MessageId: 'ses-msg-123456789',
      }),
    } as any;
    const provider = new SesEmailProvider(baseConfig, mockClient);

    const result = await provider.send({
      to: ['postulante@example.com'],
      subject: 'Confirmación de preinscripción',
      text: 'Estimado postulante, recibimos su postulación.',
      html: '<p>Estimado postulante, recibimos su postulación.</p>',
      replyTo: ['coordinacion@flacso.edu.uy'],
      tags: {
        audience: 'applicant',
        submissionId: 'sub_123',
      },
    });

    expect(result.providerMessageId).toBe('ses-msg-123456789');
    expect(mockClient.send).toHaveBeenCalledTimes(1);

    const sentCommand = mockClient.send.mock.calls[0]![0];
    const input = sentCommand.input;

    expect(input.FromEmailAddress).toBe('preinscripciones@flacso.edu.uy');
    expect(input.Destination.ToAddresses).toEqual(['postulante@example.com']);
    expect(input.ReplyToAddresses).toEqual(['coordinacion@flacso.edu.uy']);
    expect(input.ConfigurationSetName).toBe('flacso-notifications-config');
    expect(input.Content.Simple.Subject.Data).toBe('Confirmación de preinscripción');
    expect(input.Content.Simple.Body.Text.Data).toBe('Estimado postulante, recibimos su postulación.');
    expect(input.Content.Simple.Body.Html.Data).toBe('<p>Estimado postulante, recibimos su postulación.</p>');
    expect(input.EmailTags).toEqual([
      { Name: 'audience', Value: 'applicant' },
      { Name: 'submissionId', Value: 'sub_123' },
    ]);
  });

  it('uses default replyToEmail from config when message does not provide one', async () => {
    const mockClient = {
      send: vi.fn().mockResolvedValue({ MessageId: 'ses-msg-replyto' }),
    } as any;
    const provider = new SesEmailProvider(baseConfig, mockClient);

    await provider.send({
      to: ['test@example.com'],
      subject: 'Test Subject',
      text: 'Body text',
      html: '<p>Body text</p>',
    });

    const sentCommand = mockClient.send.mock.calls[0]![0];
    expect(sentCommand.input.ReplyToAddresses).toEqual(['consultas@flacso.edu.uy']);
  });

  it('classifies TooManyRequestsException as transient error', async () => {
    const rateLimitError = new Error('Rate exceeded');
    rateLimitError.name = 'TooManyRequestsException';

    const mockClient = {
      send: vi.fn().mockRejectedValue(rateLimitError),
    } as any;
    const provider = new SesEmailProvider(baseConfig, mockClient);

    try {
      await provider.send({
        to: ['test@example.com'],
        subject: 'Rate limit test',
        text: 'Body with confidential data: sensitive-data-xyz',
        html: '<p>sensitive-data-xyz</p>',
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SesEmailProviderError);
      const sesErr = err as SesEmailProviderError;
      expect(sesErr.isTransient).toBe(true);
      expect(sesErr.message).toContain('TooManyRequestsException');
      // Must not leak confidential body content
      expect(sesErr.message).not.toContain('sensitive-data-xyz');
    }
  });

  it('classifies MailFromDomainNotVerifiedException as permanent error', async () => {
    const permanentError = new Error('Domain not verified');
    permanentError.name = 'MailFromDomainNotVerifiedException';

    const mockClient = {
      send: vi.fn().mockRejectedValue(permanentError),
    } as any;
    const provider = new SesEmailProvider(baseConfig, mockClient);

    try {
      await provider.send({
        to: ['test@example.com'],
        subject: 'Domain unverified test',
        text: 'Body text',
        html: '<p>Body text</p>',
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SesEmailProviderError);
      const sesErr = err as SesEmailProviderError;
      expect(sesErr.isTransient).toBe(false);
      expect(sesErr.message).toContain('MailFromDomainNotVerifiedException');
    }
  });
});
