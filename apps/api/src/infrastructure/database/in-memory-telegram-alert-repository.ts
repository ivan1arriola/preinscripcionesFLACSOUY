import crypto from 'node:crypto';
import type {
  TelegramAlertRepository,
  TelegramAlertRecord,
  EnqueueTelegramAlertInput,
  TelegramAlertCounts,
  TelegramAlertFilter,
} from '../../ports/telegram-alert-repository.js';

export class InMemoryTelegramAlertRepository implements TelegramAlertRepository {
  public alerts: TelegramAlertRecord[] = [];

  async enqueue(
    input: EnqueueTelegramAlertInput | EnqueueTelegramAlertInput[]
  ): Promise<TelegramAlertRecord[]> {
    const items = Array.isArray(input) ? input : [input];
    const now = new Date();
    const created: TelegramAlertRecord[] = [];

    for (const item of items) {
      const eventType = item.eventType ?? 'recovery';
      const dedupeKey = item.dedupeKey ?? `${item.submissionId}:${item.chatId}:${eventType}`;
      const record: TelegramAlertRecord = {
        id: `tga_${crypto.randomUUID().replace(/-/g, '')}`,
        recoveryId: item.recoveryId ?? null,
        submissionId: item.submissionId,
        chatId: item.chatId,
        eventType,
        dedupeKey,
        message: item.message,
        status: 'pending',
        attemptCount: 0,
        maxAttempts: item.maxAttempts ?? 5,
        availableAt: item.availableAt ?? now,
        lockedUntil: null,
        lockedBy: null,
        providerMessageId: null,
        lastError: null,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.alerts.push(record);
      created.push(record);
    }

    return created;
  }

  async ensureForSubmission(
    input: EnqueueTelegramAlertInput | EnqueueTelegramAlertInput[]
  ): Promise<TelegramAlertRecord[]> {
    const items = Array.isArray(input) ? input : [input];
    const now = new Date();
    const result: TelegramAlertRecord[] = [];

    for (const item of items) {
      const eventType = item.eventType ?? 'recovery';
      const dedupeKey = item.dedupeKey ?? `${item.submissionId}:${item.chatId}:${eventType}`;

      const existing = this.alerts.find((a) => a.dedupeKey === dedupeKey);
      if (existing) {
        result.push(existing);
        continue;
      }

      const record: TelegramAlertRecord = {
        id: `tga_${crypto.randomUUID().replace(/-/g, '')}`,
        recoveryId: item.recoveryId ?? null,
        submissionId: item.submissionId,
        chatId: item.chatId,
        eventType,
        dedupeKey,
        message: item.message,
        status: 'pending',
        attemptCount: 0,
        maxAttempts: item.maxAttempts ?? 5,
        availableAt: item.availableAt ?? now,
        lockedUntil: null,
        lockedBy: null,
        providerMessageId: null,
        lastError: null,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.alerts.push(record);
      result.push(record);
    }

    return result;
  }

  async claimPending(
    limit: number,
    now: Date,
    leaseDurationMs = 60_000,
    lockedBy?: string
  ): Promise<TelegramAlertRecord[]> {
    const lockedUntil = new Date(now.getTime() + leaseDurationMs);

    const candidates = this.alerts
      .filter((a) => {
        const isPending = a.status === 'pending';
        const isExpiredLease =
          a.status === 'processing' && a.lockedUntil && a.lockedUntil.getTime() < now.getTime();
        const isAvailable = a.availableAt.getTime() <= now.getTime();
        return (isPending || isExpiredLease) && isAvailable;
      })
      .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
      .slice(0, limit);

    for (const c of candidates) {
      c.status = 'processing';
      c.lockedUntil = lockedUntil;
      c.lockedBy = lockedBy ?? null;
      c.attemptCount += 1;
      c.updatedAt = now;
    }

    return candidates;
  }

  async markSent(id: string, providerMessageId?: string, now = new Date()): Promise<void> {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert) return;
    alert.status = 'sent';
    alert.providerMessageId = providerMessageId ?? null;
    alert.sentAt = now;
    alert.lockedUntil = null;
    alert.lockedBy = null;
    alert.updatedAt = now;
  }

  async markRetryableFailure(
    id: string,
    error: string,
    availableAt: Date,
    now = new Date()
  ): Promise<void> {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert) return;
    alert.status = 'pending';
    alert.lastError = error;
    alert.availableAt = availableAt;
    alert.lockedUntil = null;
    alert.lockedBy = null;
    alert.updatedAt = now;
  }

  async markPermanentFailure(id: string, error: string, now = new Date()): Promise<void> {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert) return;
    alert.status = 'failed';
    alert.lastError = error;
    alert.lockedUntil = null;
    alert.lockedBy = null;
    alert.updatedAt = now;
  }

  async getCounts(): Promise<TelegramAlertCounts> {
    const counts: TelegramAlertCounts = {
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      total: this.alerts.length,
    };

    for (const a of this.alerts) {
      if (a.status === 'pending') counts.pending++;
      else if (a.status === 'processing') counts.processing++;
      else if (a.status === 'sent') counts.sent++;
      else if (a.status === 'failed') counts.failed++;
    }

    return counts;
  }

  async listAlerts(filter?: TelegramAlertFilter): Promise<TelegramAlertRecord[]> {
    let result = [...this.alerts];
    if (filter?.status) {
      result = result.filter((a) => a.status === filter.status);
    }
    if (filter?.submissionId) {
      result = result.filter((a) => a.submissionId === filter.submissionId);
    }
    if (filter?.eventType) {
      result = result.filter((a) => a.eventType === filter.eventType);
    }
    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (filter?.offset) {
      result = result.slice(filter.offset);
    }
    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }
    return result;
  }

  async findById(id: string): Promise<TelegramAlertRecord | null> {
    const found = this.alerts.find((a) => a.id === id);
    return found ? { ...found } : null;
  }
}
