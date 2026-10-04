import type { AcademicTarget } from '@flacso/contracts';
import type { TargetSpreadsheetConfiguration, TargetSpreadsheetRepository } from '../../ports/target-spreadsheet-repository.js';
import type { KyselyDb } from './kysely.js';

export class PostgresTargetSpreadsheetRepository implements TargetSpreadsheetRepository {
  constructor(private readonly db: KyselyDb) {}

  async ensureTarget(target: AcademicTarget): Promise<void> {
    await this.db
      .insertInto('targets')
      .values({
        id: target.id,
        kind: target.kind,
        title: target.title,
        config_revision: target.configRevision,
        updated_at: new Date(),
      })
      .onConflict((oc) => oc.column('id').doUpdateSet({
        kind: target.kind,
        title: target.title,
        config_revision: target.configRevision,
        updated_at: new Date(),
      }))
      .execute();
  }

  async get(targetId: string): Promise<TargetSpreadsheetConfiguration | null> {
    const row = await this.db
      .selectFrom('target_spreadsheets')
      .selectAll()
      .where('target_id', '=', targetId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      targetId: row.target_id,
      spreadsheetId: row.spreadsheet_id,
      sheetName: row.sheet_name,
      rootFolderId: row.root_folder_id ?? undefined,
      status: (row.status as any) ?? undefined,
      lastDiscoveredAt: row.last_discovered_at ? new Date(row.last_discovered_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async list(): Promise<TargetSpreadsheetConfiguration[]> {
    const rows = await this.db
      .selectFrom('target_spreadsheets')
      .selectAll()
      .orderBy('target_id', 'asc')
      .execute();
    return rows.map((row) => ({
      targetId: row.target_id,
      spreadsheetId: row.spreadsheet_id,
      sheetName: row.sheet_name,
      rootFolderId: row.root_folder_id ?? undefined,
      status: (row.status as any) ?? undefined,
      lastDiscoveredAt: row.last_discovered_at ? new Date(row.last_discovered_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  async save(configuration: TargetSpreadsheetConfiguration): Promise<void> {
    await this.db
      .insertInto('target_spreadsheets')
      .values({
        target_id: configuration.targetId,
        spreadsheet_id: configuration.spreadsheetId,
        sheet_name: configuration.sheetName,
        root_folder_id: configuration.rootFolderId ?? null,
        status: configuration.status ?? null,
        last_discovered_at: configuration.lastDiscoveredAt ?? null,
        created_at: configuration.createdAt ?? new Date(),
        updated_at: configuration.updatedAt ?? new Date(),
      })
      .onConflict((oc) => oc.column('target_id').doUpdateSet({
        spreadsheet_id: configuration.spreadsheetId,
        sheet_name: configuration.sheetName,
        root_folder_id: configuration.rootFolderId ?? null,
        status: configuration.status ?? null,
        last_discovered_at: configuration.lastDiscoveredAt ?? null,
        updated_at: configuration.updatedAt ?? new Date(),
      }))
      .execute();
  }
}
