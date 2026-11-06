import type {
  ClaimFolderResult,
  DriveFolderRecord,
  DriveFolderRepository,
} from '../../ports/drive-folder-repository.js';

interface StoredFolder {
  driveFolderId: string;
  createdAt: Date;
  confirmedAt: Date | null;
}

export class InMemoryDriveFolderRepository implements DriveFolderRepository {
  private readonly folders = new Map<string, StoredFolder>();

  async findFolder(folderKey: string): Promise<DriveFolderRecord | null> {
    const existing = this.folders.get(folderKey);
    if (!existing) return null;
    return {
      folderKey,
      driveFolderId: existing.driveFolderId,
      createdAt: existing.createdAt,
      confirmedAt: existing.confirmedAt,
    };
  }

  async claimFolder(folderKey: string, candidateId: string): Promise<ClaimFolderResult> {
    const existing = this.folders.get(folderKey);
    if (existing) {
      return { driveFolderId: existing.driveFolderId, created: false };
    }
    this.folders.set(folderKey, {
      driveFolderId: candidateId,
      createdAt: new Date(),
      confirmedAt: null,
    });
    return { driveFolderId: candidateId, created: true };
  }

  async confirm(folderKey: string): Promise<void> {
    const existing = this.folders.get(folderKey);
    if (existing) {
      existing.confirmedAt = new Date();
    }
  }
}
