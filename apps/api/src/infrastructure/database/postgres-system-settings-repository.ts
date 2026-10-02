import type { Kysely } from 'kysely';
import type {
  SystemSettingsRepository,
  SystemSettingRecord,
} from '../../ports/system-settings-repository.js';

export class PostgresSystemSettingsRepository implements SystemSettingsRepository {
  constructor(private readonly db: Kysely<any>) {}

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('system_settings')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();

    return row ? (row.value as string) : null;
  }

  async getSettingRecord(key: string): Promise<SystemSettingRecord | null> {
    const row = await this.db
      .selectFrom('system_settings')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();

    if (!row) return null;

    return {
      key: row.key as string,
      value: row.value as string,
      description: row.description as string | null,
      updatedAt: new Date(row.updated_at),
      updatedBy: row.updated_by as string,
    };
  }

  async setSetting(key: string, value: string, updatedBy = 'system'): Promise<void> {
    await this.db
      .insertInto('system_settings')
      .values({
        key,
        value,
        updated_at: new Date(),
        updated_by: updatedBy,
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value,
          updated_at: new Date(),
          updated_by: updatedBy,
        })
      )
      .execute();
  }

  async getAllSettings(): Promise<SystemSettingRecord[]> {
    const rows = await this.db
      .selectFrom('system_settings')
      .selectAll()
      .orderBy('key', 'asc')
      .execute();

    return rows.map((row) => ({
      key: row.key as string,
      value: row.value as string,
      description: row.description as string | null,
      updatedAt: new Date(row.updated_at),
      updatedBy: row.updated_by as string,
    }));
  }
}
