import crypto from 'node:crypto';
import type {
  SubmissionRepository,
  ValidatedSubmissionRecord,
  SavedSubmissionResult,
} from '../../ports/submission-repository.js';
import type { SubmissionRecoveryRepository } from '../../ports/submission-recovery-repository.js';

export class InMemorySubmissionRepository implements SubmissionRepository {
  public submissions: Array<ValidatedSubmissionRecord & { id: string; submittedAt: Date }> = [];
  public processingStatuses: Map<string, { status: string; errorMessage?: string }> = new Map();
  public fileStatuses: Map<string, { status: string; driveFileId?: string; errorMessage?: string }> = new Map();

  constructor(public recoveryRepository?: SubmissionRecoveryRepository) {}

  async save(record: ValidatedSubmissionRecord): Promise<SavedSubmissionResult> {
    return this.saveOrGet(record);
  }

  async findByClientSubmissionId(clientSubmissionId: string): Promise<{ id: string } | null> {
    const existing = this.submissions.find((s) => s.clientSubmissionId === clientSubmissionId);
    return existing ? { id: existing.id } : null;
  }

  async saveOrGet(record: ValidatedSubmissionRecord): Promise<SavedSubmissionResult> {
    if (record.clientSubmissionId) {
      const existing = this.submissions.find((s) => s.clientSubmissionId === record.clientSubmissionId);
      if (existing) {
        return { id: existing.id, existing: true };
      }
    }

    const id = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
    this.submissions.push({
      ...record,
      id,
      submittedAt: new Date(),
    });
    this.processingStatuses.set(id, { status: 'pending' });
    for (const file of record.files ?? []) {
      this.fileStatuses.set(file.token, { status: 'pending' });
    }
    return { id, existing: false, leaseOwner: `req_${crypto.randomUUID().replace(/-/g, '')}` };
  }

  async markProcessing(id: string, status: 'pending' | 'success' | 'failed' | 'unknown', errorMessage?: string): Promise<void> {
    this.processingStatuses.set(id, { status, errorMessage });
  }

  async markFileStored(token: string, driveFileId: string): Promise<void> {
    this.fileStatuses.set(token, { status: 'success', driveFileId });
  }

  async markFileFailed(token: string, errorMessage: string): Promise<void> {
    this.fileStatuses.set(token, { status: 'failed', errorMessage });
  }

  async recordProcessingFailure(
    id: string,
    stage: 'drive' | 'sheets' | 'notifications' | 'unknown',
    safeError: string,
    retentionDays: number = 7
  ): Promise<void> {
    this.processingStatuses.set(id, { status: 'failed', errorMessage: safeError });
    if (this.recoveryRepository) {
      const sub = this.submissions.find((s) => s.id === id);
      await this.recoveryRepository.recordFailure({
        submissionId: id,
        targetId: sub?.targetId ?? 'unknown',
        stage,
        safeError,
        retentionDays,
      });
    }
  }
}
