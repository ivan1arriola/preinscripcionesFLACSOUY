export interface SystemSettingRecord {
  key: string;
  value: string;
  description?: string | null;
  updatedAt: Date;
  updatedBy: string;
}

export interface SystemSettingsRepository {
  getSetting(key: string): Promise<string | null>;
  getSettingRecord(key: string): Promise<SystemSettingRecord | null>;
  setSetting(key: string, value: string, updatedBy?: string): Promise<void>;
  getAllSettings(): Promise<SystemSettingRecord[]>;
}
