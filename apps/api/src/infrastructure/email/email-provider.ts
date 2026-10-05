export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string[];
  tags?: Record<string, string>;
}

export type EmailProviderErrorClassification = 'retryable' | 'permanent' | 'unknown';

export class EmailProviderError extends Error {
  constructor(
    message: string,
    public readonly classification: EmailProviderErrorClassification,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

export interface EmailProvider {
  verify(): Promise<void>;
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export class FakeEmailProvider implements EmailProvider {
  public readonly sentMessages: Array<EmailMessage & { providerMessageId: string }> = [];

  async verify(): Promise<void> {
    // Intentionally no-op: test/development fakes must never contact SMTP.
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.sentMessages.push({ ...message, providerMessageId });
    return { providerMessageId };
  }
}
