import type { EmailNotificationRepository } from '../ports/email-notification-repository.js';
import {
  SesEmailProviderError,
  type EmailProvider,
  type EmailMessage,
} from '../infrastructure/email/ses-client.js';
import {
  renderApplicantNotification,
  renderOperationalNotification,
  type RenderedNotification,
} from '../infrastructure/email/notification-templates.js';

export const DEFAULT_BACKOFF_SCHEDULE_MS = [
  60_000,       // 1 minuto
  300_000,      // 5 minutos
  1_800_000,    // 30 minutos
  7_200_000,    // 2 horas
];

export function calculateBackoffMs(attemptCount: number): number {
  if (attemptCount <= 1) return 60_000;
  if (attemptCount === 2) return 300_000;
  if (attemptCount === 3) return 1_800_000;
  return 7_200_000;
}

export function calculateNextAttemptTime(
  attemptCount: number,
  now: Date,
  schedule: number[] = DEFAULT_BACKOFF_SCHEDULE_MS
): Date {
  const index = Math.min(Math.max(0, attemptCount - 1), schedule.length - 1);
  const delay = schedule[index] ?? 60_000;
  return new Date(now.getTime() + delay);
}

export interface DispatcherOptions {
  batchSize?: number;
  maxAttempts?: number;
  leaseDurationMs?: number;
}

export interface EmailNotificationDispatcherParams {
  repository: EmailNotificationRepository;
  emailProvider?: EmailProvider;
  provider?: EmailProvider;
  getProvider?: () => Promise<EmailProvider | null>;
  batchSize?: number;
  maxAttempts?: number;
  leaseDurationMs?: number;
}

export interface DispatchBatchResult {
  claimed: number;
  processed: number;
  sent: number;
  failed: number;
  failedPermanent: number;
  failedRetryable: number;
  retryable: number;
  unknown: number;
}

export class EmailNotificationDispatcher {
  private readonly repository: EmailNotificationRepository;
  private readonly provider?: EmailProvider;
  private readonly getProvider?: () => Promise<EmailProvider | null>;
  private readonly options: DispatcherOptions;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isExecuting = false;

  constructor(
    repositoryOrParams: EmailNotificationRepository | EmailNotificationDispatcherParams,
    provider?: EmailProvider,
    options: DispatcherOptions = {}
  ) {
    if ('repository' in repositoryOrParams) {
      this.repository = repositoryOrParams.repository;
      this.provider = repositoryOrParams.emailProvider ?? repositoryOrParams.provider;
      this.getProvider = repositoryOrParams.getProvider;
      this.options = {
        batchSize: repositoryOrParams.batchSize,
        maxAttempts: repositoryOrParams.maxAttempts,
        leaseDurationMs: repositoryOrParams.leaseDurationMs,
      };
    } else {
      this.repository = repositoryOrParams;
      this.provider = provider;
      this.options = options;
    }
  }

  async dispatchBatch(now: Date = new Date()): Promise<DispatchBatchResult> {
    return this.dispatchPending(now);
  }

  async dispatchPending(now: Date = new Date()): Promise<DispatchBatchResult> {
    const provider = this.provider ?? (this.getProvider ? await this.getProvider() : null);
    if (!provider) {
      return {
        claimed: 0,
        processed: 0,
        sent: 0,
        failed: 0,
        failedPermanent: 0,
        failedRetryable: 0,
        retryable: 0,
        unknown: 0,
      };
    }

    const batchSize = this.options.batchSize ?? 10;
    const maxAttempts = this.options.maxAttempts ?? 5;
    const leaseDurationMs = this.options.leaseDurationMs ?? 300_000;

    const claimed = await this.repository.claimPending(batchSize, now, leaseDurationMs);

    let sent = 0;
    let failed = 0;
    let failedPermanent = 0;
    let failedRetryable = 0;
    let retryable = 0;
    let unknown = 0;

    for (const record of claimed) {
      try {
        let rendered: RenderedNotification;
        if (record.audience === 'applicant') {
          rendered = renderApplicantNotification(record.payload);
        } else {
          rendered = renderOperationalNotification(
            record.payload,
            record.audience,
            record.recipientEmail
          );
        }

        const msg: EmailMessage = {
          to: [record.recipientEmail],
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          replyTo: rendered.replyTo,
          tags: {
            submissionId: record.submissionId,
            targetId: record.targetId,
            audience: record.audience,
          },
        };

        const res = await provider.send(msg);
        await this.repository.markSent(record.id, res.providerMessageId, now);
        sent++;
      } catch (err) {
        if (err instanceof SesEmailProviderError) {
          if (err.isTransient) {
            if (record.attemptCount >= maxAttempts) {
              const errMsg = `Excedido el límite de reintentos (${maxAttempts}): ${err.message}`;
              await this.repository.markPermanentFailure(record.id, errMsg, now);
              failed++;
              failedPermanent++;
            } else {
              const backoffMs = calculateBackoffMs(record.attemptCount);
              const nextAvailableAt = new Date(now.getTime() + backoffMs);
              await this.repository.markRetryableFailure(record.id, err.message, nextAvailableAt);
              retryable++;
              failedRetryable++;
            }
          } else {
            await this.repository.markPermanentFailure(record.id, err.message, now);
            failed++;
            failedPermanent++;
          }
        } else {
          // Error desconocido o caída de red sin confirmación (Unknown error)
          const errMsg = err instanceof Error ? err.message : String(err);
          await this.repository.markUnknown(record.id, errMsg);
          unknown++;
        }
      }
    }

    return {
      claimed: claimed.length,
      processed: claimed.length,
      sent,
      failed,
      failedPermanent,
      failedRetryable,
      retryable,
      unknown,
    };
  }

  start(intervalMs = 15_000): { stop: () => void } {
    if (this.isRunning) return { stop: () => this.stop() };
    this.isRunning = true;

    const tick = async () => {
      if (!this.isRunning || this.isExecuting) return;
      this.isExecuting = true;
      try {
        await this.dispatchPending();
      } catch (err) {
        console.error('[Notification Dispatcher] Error no controlado en ciclo:', err);
      } finally {
        this.isExecuting = false;
      }
    };

    this.timer = setInterval(() => {
      void tick();
    }, intervalMs);
    this.timer.unref();

    void tick();

    return { stop: () => this.stop() };
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
