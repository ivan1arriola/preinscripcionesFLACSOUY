import type {
  SystemSettingsRepository,
  SystemSettingRecord,
} from '../../ports/system-settings-repository.js';

export class MemorySystemSettingsRepository implements SystemSettingsRepository {
  private readonly settings = new Map<string, SystemSettingRecord>();

  constructor(initialSettings: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initialSettings)) {
      this.settings.set(key, {
        key,
        value,
        updatedAt: new Date(),
        updatedBy: 'system',
      });
    }
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key)?.value ?? null;
  }

  async getSettingRecord(key: string): Promise<SystemSettingRecord | null> {
    const record = this.settings.get(key);
    return record ? { ...record } : null;
  }

  async setSetting(key: string, value: string, updatedBy = 'system'): Promise<void> {
    this.settings.set(key, {
      key,
      value,
      updatedAt: new Date(),
      updatedBy,
    });
  }

  async getAllSettings(): Promise<SystemSettingRecord[]> {
    return Array.from(this.settings.values()).map((r) => ({ ...r }));
  }
}
