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

export interface GoogleDriveRepositoryPort {
  storeSubmissionFiles(command: StoreSubmissionFilesCommand): Promise<StoredDriveFile[]>;
}
