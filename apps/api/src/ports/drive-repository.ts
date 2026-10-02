export interface DriveFolders {
  targetFolderId: string;
  documentsFolderId: string;
}

export interface DriveFileReference {
  fileId: string;
  webViewLink: string;
}

export interface DriveRepository {
  resolveTargetFolders(targetId: string, targetTitle: string): Promise<DriveFolders>;
  uploadDocument(
    folderId: string,
    filename: string,
    mimeType: string,
    content: Buffer
  ): Promise<DriveFileReference>;
}
