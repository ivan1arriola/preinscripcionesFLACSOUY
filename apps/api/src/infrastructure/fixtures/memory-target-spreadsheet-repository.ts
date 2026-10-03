import type { AcademicTarget } from '@flacso/contracts';
import type {
  TargetSpreadsheetConfiguration,
  TargetSpreadsheetRepository,
} from '../../ports/target-spreadsheet-repository.js';

export class MemoryTargetSpreadsheetRepository implements TargetSpreadsheetRepository {
  private readonly records = new Map<string, TargetSpreadsheetConfiguration>();

  async ensureTarget(_target: AcademicTarget): Promise<void> {}

  async get(targetId: string): Promise<TargetSpreadsheetConfiguration | null> {
    const record = this.records.get(targetId);
    return record ? { ...record } : null;
  }

  async list(): Promise<TargetSpreadsheetConfiguration[]> {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  async save(configuration: TargetSpreadsheetConfiguration): Promise<void> {
    this.records.set(configuration.targetId, { ...configuration });
  }
}
