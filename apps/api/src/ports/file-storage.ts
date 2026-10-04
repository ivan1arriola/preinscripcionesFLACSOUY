export interface FileUpload {
  originalName: string;
  mimeType: string;
  data: Buffer;
}

export interface TemporaryFileRecord {
  token: string;
  sessionId: string;
  targetId?: string;
  fieldKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  expiresAt?: Date;
}

export interface SaveFileMetadata {
  targetId?: string;
}

export interface TemporaryFileStoragePort {
  save(sessionId: string, fieldKey: string, upload: FileUpload, meta?: SaveFileMetadata): Promise<TemporaryFileRecord>;
  open(token: string, sessionId: string): Promise<FileUpload & { createdAt: Date }>;
  remove(token: string, sessionId?: string): Promise<void>;
  cleanup(before: number): Promise<number>;
  listBySession?(sessionId: string): Promise<TemporaryFileRecord[]>;
  touch?(sessionId: string): Promise<void>;
}
