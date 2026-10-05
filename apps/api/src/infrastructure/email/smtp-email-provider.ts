import nodemailer from 'nodemailer';
import type { EmailMessage, EmailProvider, EmailProviderErrorClassification } from './email-provider.js';
import { EmailProviderError } from './email-provider.js';
import type { SmtpConfig } from './email-config.js';

export interface SmtpTransport {
  verify(): Promise<unknown>;
  sendMail(message: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    replyTo?: string[];
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string }>;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function smtpTransportOptions(config: SmtpConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    ...(config.security === 'starttls' ? { requireTLS: true } : {}),
    auth: {
      user: config.username,
      pass: config.password,
    },
  };
}

function messageTagsHeader(tags: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!tags || Object.keys(tags).length === 0) return undefined;
  return {
    'X-FLACSO-Notification-Tags': Object.entries(tags)
      .map(([key, value]) => `${key}=${value}`)
      .join(','),
  };
}

function smtpErrorDetails(error: unknown): { code?: string; responseCode?: number; command?: string } {
  if (!error || typeof error !== 'object') return {};
  const candidate = error as Record<string, unknown>;
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    responseCode: typeof candidate.responseCode === 'number' ? candidate.responseCode : undefined,
    command: typeof candidate.command === 'string' ? candidate.command : undefined,
  };
}

function classifySmtpError(error: unknown): EmailProviderErrorClassification {
  const { code, responseCode, command } = smtpErrorDetails(error);
  if (command?.toUpperCase().includes('DATA')) return 'unknown';
  if (typeof responseCode === 'number') {
    if (responseCode >= 500) return 'permanent';
    if (responseCode >= 400) return 'retryable';
  }
  if (code === 'EAUTH' || code === 'EENVELOPE') return 'permanent';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'EAI_AGAIN') {
    return 'retryable';
  }
  return 'unknown';
}

function safeSmtpErrorMessage(error: unknown): string {
  const { code, responseCode, command } = smtpErrorDetails(error);
  const details = [code, responseCode ? String(responseCode) : undefined, command]
    .filter((value): value is string => Boolean(value))
    .join('/');
  return details ? `Error SMTP (${details})` : 'Error SMTP sin diagnóstico seguro';
}

export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: SmtpTransport;

  constructor(
    private readonly config: SmtpConfig,
    transport?: SmtpTransport,
  ) {
    this.transport = transport ?? nodemailer.createTransport(smtpTransportOptions(config));
  }

  async verify(): Promise<void> {
    try {
      await this.transport.verify();
    } catch (error) {
      throw new EmailProviderError(safeSmtpErrorMessage(error), classifySmtpError(error));
    }
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    if (message.to.length === 0 || message.to.some((recipient) => !EMAIL_REGEX.test(recipient.trim()))) {
      throw new EmailProviderError('Destinatarios inválidos o vacíos.', 'permanent');
    }

    try {
      const response = await this.transport.sendMail({
        from: this.config.fromEmail,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo?.length ? message.replyTo : this.config.replyToEmail ? [this.config.replyToEmail] : undefined,
        headers: messageTagsHeader(message.tags),
      });
      if (!response.messageId) {
        throw new EmailProviderError('SMTP no confirmó identificador de mensaje.', 'unknown');
      }
      return { providerMessageId: response.messageId };
    } catch (error) {
      if (error instanceof EmailProviderError) throw error;
      throw new EmailProviderError(safeSmtpErrorMessage(error), classifySmtpError(error));
    }
  }
}
