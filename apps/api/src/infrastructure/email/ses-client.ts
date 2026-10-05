import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { SesCredentialsConfig } from './email-config.js';

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string[];
  tags?: Record<string, string>;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export class SesEmailProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly isTransient: boolean = false
  ) {
    super(message);
    this.name = 'SesEmailProviderError';
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SesEmailProvider implements EmailProvider {
  private readonly client: SESv2Client;

  constructor(
    private readonly config: SesCredentialsConfig,
    client?: SESv2Client
  ) {
    this.client =
      client ??
      new SESv2Client({
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          sessionToken: config.sessionToken,
        },
      });
  }

  async verify(): Promise<void> {
    // The legacy SES API adapter has no separate non-sending verification call.
    // This keeps the provider contract compatible until SMTP replaces it.
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    if (!message.to || message.to.length === 0) {
      throw new SesEmailProviderError('Destinatarios vacíos: se requiere al menos un destinatario.', undefined, false);
    }

    for (const recipient of message.to) {
      if (!recipient || !EMAIL_REGEX.test(recipient.trim())) {
        throw new SesEmailProviderError(`Destinatario inválido: ${recipient}`, undefined, false);
      }
    }

    const replyToAddresses =
      message.replyTo && message.replyTo.length > 0
        ? message.replyTo
        : this.config.replyToEmail
        ? [this.config.replyToEmail]
        : undefined;

    const command = new SendEmailCommand({
      FromEmailAddress: this.config.fromEmail,
      Destination: {
        ToAddresses: message.to,
      },
      ReplyToAddresses: replyToAddresses,
      ConfigurationSetName: this.config.configurationSet,
      Content: {
        Simple: {
          Subject: {
            Data: message.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: message.text,
              Charset: 'UTF-8',
            },
            Html: {
              Data: message.html,
              Charset: 'UTF-8',
            },
          },
        },
      },
      EmailTags: message.tags
        ? Object.entries(message.tags).map(([Name, Value]) => ({ Name, Value }))
        : undefined,
    });

    try {
      const response = await this.client.send(command);
      if (!response.MessageId) {
        throw new SesEmailProviderError('Amazon SES no devolvió MessageId en la respuesta.', undefined, false);
      }
      return { providerMessageId: response.MessageId };
    } catch (error) {
      if (error instanceof SesEmailProviderError) {
        throw error;
      }

      const errorName = (error as any)?.name ?? '';
      const statusCode = (error as any)?.$metadata?.httpStatusCode;

      const isTransient =
        errorName === 'TooManyRequestsException' ||
        errorName === 'LimitExceededException' ||
        errorName === 'ServiceUnavailableException' ||
        errorName === 'InternalServiceErrorException' ||
        (typeof statusCode === 'number' && statusCode >= 500);

      const safeMessage = `Error de envío en Amazon SES [${errorName || 'UnknownError'}]: ${
        error instanceof Error ? error.message : String(error)
      }`;

      throw new SesEmailProviderError(safeMessage, error, isTransient);
    }
  }
}

export class FakeEmailProvider implements EmailProvider {
  public sentMessages: Array<EmailMessage & { providerMessageId: string }> = [];

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.sentMessages.push({ ...message, providerMessageId });
    return { providerMessageId };
  }
}
