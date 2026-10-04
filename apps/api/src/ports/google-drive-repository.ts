import type { DriveTargetDescriptor } from '../domain/google-drive-naming.js';

export interface DriveUploadFile {
  token: string;
  fieldKey?: string;
  originalName: string;
  mimeType: string;
  data: Buffer;
}

export interface StoreSubmissionFilesCommand {
  submissionId: string;
  files: DriveUploadFile[];
  target?: DriveTargetDescriptor;
  values?: Record<string, string>;
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

export type { SpreadsheetDiscovery, SpreadsheetDiscoveryPort } from './spreadsheet-discovery.js';

export interface GoogleDriveRepositoryPort {
  storeSubmissionFiles(command: StoreSubmissionFilesCommand): Promise<StoredDriveFile[]>;
  inspectFolder?(folderId: string): Promise<GoogleDriveFolderInfo>;
}
