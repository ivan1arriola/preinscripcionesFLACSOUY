import crypto from 'node:crypto';
import type {
  SubmissionRepository,
  ValidatedSubmissionRecord,
  SavedSubmissionResult,
} from '../../ports/submission-repository.js';

export class InMemorySubmissionRepository implements SubmissionRepository {
  public submissions: Array<ValidatedSubmissionRecord & { id: string; submittedAt: Date }> = [];

  async save(record: ValidatedSubmissionRecord): Promise<SavedSubmissionResult> {
    const id = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
    this.submissions.push({
      ...record,
      id,
      submittedAt: new Date(),
    });
    return { id };
  }
}
