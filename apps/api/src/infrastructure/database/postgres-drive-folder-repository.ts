import type { KyselyDb } from './kysely.js';
import type {
  ClaimFolderResult,
  DriveFolderRecord,
  DriveFolderRepository,
} from '../../ports/drive-folder-repository.js';

export class PostgresDriveFolderRepository implements DriveFolderRepository {
  constructor(private readonly db: KyselyDb) {}

  async findFolder(folderKey: string): Promise<DriveFolderRecord | null> {
    const row = await this.db
      .selectFrom('drive_folders')
      .select(['folder_key', 'drive_folder_id', 'created_at', 'confirmed_at'])
      .where('folder_key', '=', folderKey)
      .executeTakeFirst();

    if (!row) return null;
    return {
      folderKey: row.folder_key,
      driveFolderId: row.drive_folder_id,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
    };
  }

  async claimFolder(folderKey: string, candidateId: string): Promise<ClaimFolderResult> {
    const inserted = await this.db
      .insertInto('drive_folders')
      .values({
        folder_key: folderKey,
        drive_folder_id: candidateId,
      })
      .onConflict((oc) => oc.column('folder_key').doNothing())
      .returning(['folder_key', 'drive_folder_id'])
      .executeTakeFirst();

    if (inserted) {
      return { driveFolderId: inserted.drive_folder_id, created: true };
    }

    const existing = await this.db
      .selectFrom('drive_folders')
      .select('drive_folder_id')
      .where('folder_key', '=', folderKey)
      .executeTakeFirstOrThrow();

    return { driveFolderId: existing.drive_folder_id, created: false };
  }

  async confirm(folderKey: string): Promise<void> {
    await this.db
      .updateTable('drive_folders')
      .set({ confirmed_at: new Date() })
      .where('folder_key', '=', folderKey)
      .execute();
  }
}
