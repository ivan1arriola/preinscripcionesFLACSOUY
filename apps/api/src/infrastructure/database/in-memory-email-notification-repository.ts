import crypto from 'node:crypto';
import type {
  EmailNotificationRepository,
  EmailNotificationRecord,
  EnsureEmailNotificationsInput,
  EmailNotificationFilter,
} from '../../ports/email-notification-repository.js';

export class InMemoryEmailNotificationRepository implements EmailNotificationRepository {
  private records: Map<string, EmailNotificationRecord> = new Map();

  async ensureForSubmission(input: EnsureEmailNotificationsInput): Promise<EmailNotificationRecord[]> {
    const results: EmailNotificationRecord[] = [];
    const now = input.availableAt ?? new Date();

    for (const recipient of input.recipients) {
      const normalizedEmail = recipient.email.trim().toLowerCase();
      if (!normalizedEmail) continue;

      // Search if a record with this deduplication key already exists
      let existing = Array.from(this.records.values()).find(
        (r) =>
          r.submissionId === input.submissionId &&
          r.audience === recipient.audience &&
          r.recipientEmail === normalizedEmail &&
          r.templateVersion === input.snapshot.templateVersion
      );

      if (!existing) {
        const id = `notif_${crypto.randomUUID()}`;
        existing = {
          id,
          submissionId: input.submissionId,
          audience: recipient.audience,
          recipientEmail: normalizedEmail,
          targetId: input.snapshot.targetId,
          templateVersion: input.snapshot.templateVersion,
          payload: JSON.parse(JSON.stringify(input.snapshot)),
          status: 'pending',
          attemptCount: 0,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        };
        this.records.set(id, existing);
      }

      results.push({ ...existing });
    }

    return results;
  }

  async claimPending(limit: number, now: Date, leaseDurationMs = 300_000): Promise<EmailNotificationRecord[]> {
    const eligible: EmailNotificationRecord[] = [];

    for (const record of this.records.values()) {
      const isPending = record.status === 'pending';
      const isExpiredProcessing =
        record.status === 'processing' && record.lockedUntil && record.lockedUntil < now;

      if ((isPending || isExpiredProcessing) && record.availableAt <= now) {
        if (!record.lockedUntil || record.lockedUntil < now) {
          eligible.push(record);
        }
      }
    }

    // Sort by availableAt asc, then createdAt asc
    eligible.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime());

    const claimed: EmailNotificationRecord[] = [];
    for (let i = 0; i < Math.min(limit, eligible.length); i++) {
      const item = eligible[i]!;
      item.status = 'processing';
      item.lockedUntil = new Date(now.getTime() + leaseDurationMs);
      item.attemptCount += 1;
      item.updatedAt = now;
      claimed.push({ ...item });
    }

    return claimed;
  }

  async markSent(id: string, providerMessageId: string, now: Date): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;

    record.status = 'sent';
    record.providerMessageId = providerMessageId;
    record.sentAt = now;
    record.lockedUntil = undefined;
    record.lastError = undefined;
    record.updatedAt = now;
  }

  async markRetryableFailure(id: string, error: string, availableAt: Date): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;

    record.status = 'pending';
    record.lastError = error;
    record.availableAt = availableAt;
    record.lockedUntil = undefined;
    record.updatedAt = new Date();
  }

  async markPermanentFailure(id: string, error: string, now: Date): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;

    record.status = 'failed';
    record.lastError = error;
    record.lockedUntil = undefined;
    record.updatedAt = now;
  }

  async markUnknown(id: string, error: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;

    record.status = 'unknown';
    record.lastError = error;
    record.lockedUntil = undefined;
    record.updatedAt = new Date();
  }

  async listMissingForSuccessfulSubmissions(_limit: number): Promise<string[]> {
    return [];
  }

  async listNotifications(filter?: EmailNotificationFilter): Promise<EmailNotificationRecord[]> {
    let list = Array.from(this.records.values());

    if (filter?.status) {
      list = list.filter((r) => r.status === filter.status);
    }
    if (filter?.submissionId) {
      list = list.filter((r) => r.submissionId === filter.submissionId);
    }

    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? list.length;
    return list.slice(offset, offset + limit).map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<EmailNotificationRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  async resetForManualRetry(id: string, now: Date): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;

    if (record.status === 'failed' || record.status === 'unknown') {
      record.status = 'pending';
      record.availableAt = now;
      record.lockedUntil = undefined;
      record.updatedAt = now;
    }
  }
}
