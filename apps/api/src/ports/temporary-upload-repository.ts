export interface TemporaryUploadRecord {
  token: string;
  sessionId: string;
  targetId?: string;
  fieldKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
}

export interface CreateTemporaryUploadInput {
  token: string;
  sessionId: string;
  targetId?: string;
  fieldKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  expiresAt?: Date;
}

export interface TemporaryUploadRepository {
  create(input: CreateTemporaryUploadInput): Promise<TemporaryUploadRecord>;
  get(token: string, sessionId?: string): Promise<TemporaryUploadRecord | null>;
  listBySession(sessionId: string): Promise<TemporaryUploadRecord[]>;
  touch(sessionId: string, newExpiresAt?: Date): Promise<void>;
  remove(token: string, sessionId?: string): Promise<boolean>;
  listExpired(before: Date): Promise<TemporaryUploadRecord[]>;
  deleteMetadata(token: string): Promise<void>;
}
