import crypto from 'node:crypto';
import type {
  SubmissionRepository,
  ValidatedSubmissionRecord,
  SavedSubmissionResult,
} from '../../ports/submission-repository.js';

export class InMemorySubmissionRepository implements SubmissionRepository {
  public submissions: Array<ValidatedSubmissionRecord & { id: string; submittedAt: Date }> = [];
  public processingStatuses: Map<string, { status: string; errorMessage?: string }> = new Map();
  public fileStatuses: Map<string, { status: string; driveFileId?: string; errorMessage?: string }> = new Map();

  async save(record: ValidatedSubmissionRecord): Promise<SavedSubmissionResult> {
    return this.saveOrGet(record);
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
    return { id, existing: false };
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
}
