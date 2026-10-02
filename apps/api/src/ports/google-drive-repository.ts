export interface DriveUploadFile {
  token: string;
  originalName: string;
  mimeType: string;
  data: Buffer;
}

export interface StoreSubmissionFilesCommand {
  submissionId: string;
  files: DriveUploadFile[];
}

export interface StoredDriveFile {
  token: string;
  driveFileId: string;
}

export interface GoogleDriveFolderInfo {
  id: string;
  name: string;
  canAddChildren: boolean;
}

export interface GoogleDriveRepositoryPort {
  storeSubmissionFiles(command: StoreSubmissionFilesCommand): Promise<StoredDriveFile[]>;
  inspectFolder?(folderId: string): Promise<GoogleDriveFolderInfo>;
}
