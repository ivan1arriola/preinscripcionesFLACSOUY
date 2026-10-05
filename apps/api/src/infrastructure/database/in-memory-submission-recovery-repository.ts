import crypto from 'node:crypto';
import type {
  SubmissionRecoveryRepository,
  SubmissionRecoveryRecord,
  CreateRecoveryInput,
  SubmissionRecoveryFilter,
  RetryResultInput,
} from '../../ports/submission-recovery-repository.js';

export class InMemorySubmissionRecoveryRepository implements SubmissionRecoveryRepository {
  private records: Map<string, SubmissionRecoveryRecord> = new Map();

  async recordFailure(input: CreateRecoveryInput): Promise<SubmissionRecoveryRecord> {
    const now = input.now ?? new Date();
    const retentionDays = input.retentionDays ?? 7;
    const retentionExpiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    const existing = Array.from(this.records.values()).find(
      (r) => r.submissionId === input.submissionId
    );

    if (existing) {
      existing.stage = input.stage;
      existing.safeError = input.safeError;
      existing.status = 'pending';
      existing.attemptCount += 1;
      existing.lastAttemptAt = now;
      existing.lockedUntil = null;
      existing.lockedBy = null;
      existing.updatedAt = now;
      return { ...existing };
    }

    const id = `rec_${crypto.randomUUID().slice(0, 12)}`;
    const record: SubmissionRecoveryRecord = {
      id,
      submissionId: input.submissionId,
      targetId: input.targetId,
      stage: input.stage,
      status: 'pending',
      safeError: input.safeError,
      attemptCount: 1,
      firstFailedAt: now,
      lastAttemptAt: now,
      retentionExpiresAt,
      lockedUntil: null,
      lockedBy: null,
      discardedAt: null,
      discardedBy: null,
      discardReason: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
      files: [],
    };

    this.records.set(id, record);
    return { ...record };
  }

  async listFailed(filter?: SubmissionRecoveryFilter): Promise<SubmissionRecoveryRecord[]> {
    let list = Array.from(this.records.values());

    if (filter?.status) {
      if (Array.isArray(filter.status)) {
        list = list.filter((r) => filter.status!.includes(r.status));
      } else {
        list = list.filter((r) => r.status === filter.status);
      }
    }

    if (filter?.stage) {
      list = list.filter((r) => r.stage === filter.stage);
    }

    if (filter?.targetId) {
      list = list.filter((r) => r.targetId === filter.targetId);
    }

    list.sort((a, b) => b.lastAttemptAt.getTime() - a.lastAttemptAt.getTime());

    if (filter?.offset) {
      list = list.slice(filter.offset);
    }

    if (filter?.limit) {
      list = list.slice(0, filter.limit);
    }

    return list.map((r) => ({ ...r, files: r.files ? [...r.files] : [] }));
  }

  async findById(idOrSubmissionId: string): Promise<SubmissionRecoveryRecord | null> {
    const record =
      this.records.get(idOrSubmissionId) ||
      Array.from(this.records.values()).find((r) => r.submissionId === idOrSubmissionId);

    if (!record) return null;
    return { ...record, files: record.files ? [...record.files] : [] };
  }

  async claim(
    id: string,
    now: Date,
    leaseDurationMs: number = 60000,
    lockedBy?: string
  ): Promise<SubmissionRecoveryRecord | null> {
    const record = await this.findById(id);
    if (!record) return null;

    if (record.status !== 'pending' && record.status !== 'retrying') {
      return null;
    }

    if (record.lockedUntil && record.lockedUntil > now) {
      return null;
    }

    const liveRecord = this.records.get(record.id)!;
    liveRecord.lockedUntil = new Date(now.getTime() + leaseDurationMs);
    liveRecord.lockedBy = lockedBy ?? null;
    liveRecord.status = 'retrying';
    liveRecord.updatedAt = now;

    return { ...liveRecord };
  }

  async release(id: string): Promise<void> {
    const record = await this.findById(id);
    if (!record) return;

    const liveRecord = this.records.get(record.id)!;
    liveRecord.lockedUntil = null;
    liveRecord.lockedBy = null;
    liveRecord.status = 'pending';
    liveRecord.updatedAt = new Date();
  }

  async markRetryResult(id: string, result: RetryResultInput): Promise<void> {
    const record = await this.findById(id);
    if (!record) return;

    const liveRecord = this.records.get(record.id)!;
    const now = result.now ?? new Date();

    if (result.success) {
      liveRecord.status = 'resolved';
      liveRecord.resolvedAt = now;
      liveRecord.lockedUntil = null;
      liveRecord.lockedBy = null;
      liveRecord.updatedAt = now;
    } else {
      liveRecord.status = 'pending';
      if (result.stage) liveRecord.stage = result.stage;
      if (result.safeError) liveRecord.safeError = result.safeError;
      liveRecord.attemptCount += 1;
      liveRecord.lastAttemptAt = now;
      liveRecord.lockedUntil = null;
      liveRecord.lockedBy = null;
      liveRecord.updatedAt = now;
    }
  }

  async discard(id: string, discardedBy: string, reason?: string, now?: Date): Promise<void> {
    const record = await this.findById(id);
    if (!record) return;

    const liveRecord = this.records.get(record.id)!;
    const ts = now ?? new Date();
    liveRecord.status = 'discarded';
    liveRecord.discardedAt = ts;
    liveRecord.discardedBy = discardedBy;
    liveRecord.discardReason = reason ?? null;
    liveRecord.lockedUntil = null;
    liveRecord.lockedBy = null;
    liveRecord.updatedAt = ts;
  }

  async deleteExpired(now: Date): Promise<string[]> {
    const expired: string[] = [];

    for (const [id, record] of this.records.entries()) {
      if (record.retentionExpiresAt < now) {
        expired.push(record.submissionId);
        this.records.delete(id);
      }
    }

    return expired;
  }
}
