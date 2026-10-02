export interface FileUpload {
  originalName: string;
  mimeType: string;
  data: Buffer;
}

export interface TemporaryFileRecord {
  token: string;
  sessionId: string;
  fieldKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}

export interface TemporaryFileStoragePort {
  save(sessionId: string, fieldKey: string, upload: FileUpload): Promise<TemporaryFileRecord>;
  open(token: string, sessionId: string): Promise<FileUpload & { createdAt: Date }>;
  remove(token: string, sessionId?: string): Promise<void>;
  cleanup(before: number): Promise<number>;
}
