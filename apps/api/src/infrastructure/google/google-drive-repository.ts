import type {
  DriveRepository,
  DriveFolders,
  DriveFileReference,
} from '../../ports/drive-repository.js';

export interface DriveClient {
  findOrCreateFolder(name: string, parentFolderId?: string): Promise<string>;
  uploadFile(
    folderId: string,
    filename: string,
    mimeType: string,
    content: Buffer
  ): Promise<{ id: string; webViewLink: string }>;
}

export class GoogleDriveRepository implements DriveRepository {
  constructor(
    private readonly client: DriveClient,
    private readonly rootFolderId: string
  ) {}

  async resolveTargetFolders(targetId: string, targetTitle: string): Promise<DriveFolders> {
    // 1. Resolve or create folder for target under root
    const targetFolderName = `${targetTitle} (${targetId})`;
    const targetFolderId = await this.client.findOrCreateFolder(
      targetFolderName,
      this.rootFolderId
    );

    // 2. Resolve or create subfolder "Documentación"
    const documentsFolderId = await this.client.findOrCreateFolder(
      'Documentación',
      targetFolderId
    );

    return {
      targetFolderId,
      documentsFolderId,
    };
  }

  async uploadDocument(
    folderId: string,
    filename: string,
    mimeType: string,
    content: Buffer
  ): Promise<DriveFileReference> {
    const res = await this.client.uploadFile(folderId, filename, mimeType, content);
    return {
      fileId: res.id,
      webViewLink: res.webViewLink,
    };
  }
}
