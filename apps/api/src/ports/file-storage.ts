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

export interface ResumableUploadMetadata extends SaveFileMetadata {
  originalName: string;
  mimeType: string;
  size: number;
}

export interface TemporaryFileStoragePort {
  save(sessionId: string, fieldKey: string, upload: FileUpload, meta?: SaveFileMetadata): Promise<TemporaryFileRecord>;
  open(token: string, sessionId?: string): Promise<FileUpload & { createdAt: Date }>;
  remove(token: string, sessionId?: string): Promise<void>;
  cleanup(before: number): Promise<number>;
  listBySession?(sessionId: string): Promise<TemporaryFileRecord[]>;
  /** Solo archivos pendientes que existen físicamente, excluyendo envíos retenidos y metadatos huérfanos. */
  listPendingBySession?(sessionId: string): Promise<TemporaryFileRecord[]>;
  touch?(sessionId: string): Promise<void>;
  beginResumable?(sessionId: string, fieldKey: string, upload: ResumableUploadMetadata): Promise<{ uploadId: string; offset: number }>;
  getResumableOffset?(uploadId: string, sessionId: string): Promise<number>;
  appendResumable?(uploadId: string, sessionId: string, offset: number, chunk: Buffer): Promise<number>;
  /** Cuenta las cargas reanudables en curso de la sesión para el campo. */
  countResumable?(sessionId: string, fieldKey: string): Promise<number>;
  /** `check` se ejecuta antes de guardar; si lanza, la carga en curso se descarta y el error se propaga. */
  finishResumable?(
    uploadId: string,
    sessionId: string,
    check?: (upload: { targetId?: string; fieldKey: string; size: number }) => Promise<void>,
  ): Promise<TemporaryFileRecord>;
  /** Fija los archivos de un envío (reanudable e idempotente). Lanza FILE_EXPIRED o FORBIDDEN. */
  pinFiles?(tokens: string[], sessionId: string, clientSubmissionId: string): Promise<void>;
  /** Borrado público: solo pendientes. Lanza FILE_ALREADY_SUBMITTED si el token ya está fijado. */
  removePending?(token: string, sessionId: string): Promise<void>;
  /** Borrado interno de un archivo fijado (transiciones terminales). No se expone por HTTP. */
  releaseRetained?(token: string): Promise<void>;
  /** Borra los fijados cuya retención venció. */
  cleanupExpiredRetained?(before: number): Promise<number>;
  /** Adopta archivos heredados a retained/ sin comprobar sesión (uso administrativo). Devuelve cuáles faltan. */
  adoptFiles?(tokens: string[]): Promise<string[]>;
  extendRetention?(tokens: string | string[], newExpiresAt: Date): Promise<void>;
}
