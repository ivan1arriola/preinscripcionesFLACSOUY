import type { TelegramAlertRepository } from '../ports/telegram-alert-repository.js';
import type { TelegramProvider } from '../ports/telegram-provider.js';

export const TELEGRAM_BACKOFF_SCHEDULE_MS = [
  60_000, // 1 min
  300_000, // 5 min
  1_800_000, // 30 min
  7_200_000, // 2 hr
];

export function calculateTelegramNextAttemptTime(
  attemptCount: number,
  now: Date,
  schedule = TELEGRAM_BACKOFF_SCHEDULE_MS
): Date {
  const index = Math.min(Math.max(0, attemptCount - 1), schedule.length - 1);
  const delay = schedule[index] ?? 60_000;
  return new Date(now.getTime() + delay);
}

export function isPermanentTelegramError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('chat not found') ||
    lower.includes('bot was blocked') ||
    lower.includes('user is deactivated') ||
    lower.includes("bot can't initiate conversation") ||
    lower.includes('unauthorized') ||
    lower.includes('bad request') ||
    lower.includes('chat_id is empty')
  );
}

export interface TelegramRecoveryAlertDispatcherParams {
  repository: TelegramAlertRepository;
  provider?: TelegramProvider;
  getProvider?: () => Promise<TelegramProvider | null>;
  batchSize?: number;
  leaseDurationMs?: number;
}

export interface TelegramDispatchResult {
  claimed: number;
  sent: number;
  failed: number;
}

export class TelegramRecoveryAlertDispatcher {
  private readonly repository: TelegramAlertRepository;
  private readonly provider?: TelegramProvider;
  private readonly getProvider?: () => Promise<TelegramProvider | null>;
  private readonly batchSize: number;
  private readonly leaseDurationMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isExecuting = false;

  constructor(params: TelegramRecoveryAlertDispatcherParams) {
    this.repository = params.repository;
    this.provider = params.provider;
    this.getProvider = params.getProvider;
    this.batchSize = params.batchSize ?? 10;
    this.leaseDurationMs = params.leaseDurationMs ?? 60_000;
  }

  async dispatchBatch(now: Date = new Date()): Promise<TelegramDispatchResult> {
    const alerts = await this.repository.claimPending(this.batchSize, now, this.leaseDurationMs);
    if (alerts.length === 0) {
      return { claimed: 0, sent: 0, failed: 0 };
    }

    let provider = this.provider;
    if (!provider && this.getProvider) {
      provider = (await this.getProvider()) ?? undefined;
    }

    if (!provider) {
      // Telegram is not configured or disabled. Reschedule alerts for 5 minutes in the future.
      const retryAt = new Date(now.getTime() + 300_000);
      for (const alert of alerts) {
        await this.repository.markRetryableFailure(
          alert.id,
          'Telegram no está configurado o está deshabilitado.',
          retryAt,
          now
        );
      }
      return { claimed: alerts.length, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const alert of alerts) {
      try {
        const result = await provider.send(alert.message, alert.chatId);
        await this.repository.markSent(alert.id, result.providerMessageId, now);
        sent++;
      } catch (err: any) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const safeError = this.sanitizeError(rawMessage);

        if (isPermanentTelegramError(safeError) || alert.attemptCount >= alert.maxAttempts) {
          await this.repository.markPermanentFailure(alert.id, safeError, now);
        } else {
          const nextAttempt = calculateTelegramNextAttemptTime(alert.attemptCount, now);
          await this.repository.markRetryableFailure(alert.id, safeError, nextAttempt, now);
        }
        failed++;
      }
    }

    return { claimed: alerts.length, sent, failed };
  }

  private sanitizeError(raw: string): string {
    let sanitized = raw.replace(/([?&](key|token|secret|password|access_token)=)[^&]+/gi, '$1***');
    sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer ***');
    sanitized = sanitized.replace(/\/bot[0-9]+:[a-zA-Z0-9_\-]+/g, '/bot[REDACTED_TOKEN]');
    if (sanitized.length > 500) {
      sanitized = sanitized.slice(0, 497) + '...';
    }
    return sanitized;
  }

  start(intervalMs = 15_000): { stop: () => void } {
    if (this.isRunning) {
      return { stop: () => this.stop() };
    }
    this.isRunning = true;

    const tick = async () => {
      if (!this.isRunning || this.isExecuting) return;
      this.isExecuting = true;
      try {
        await this.dispatchBatch();
      } catch (err) {
        console.error('[TelegramRecoveryAlertDispatcher] Error durante ciclo de despacho:', err);
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
