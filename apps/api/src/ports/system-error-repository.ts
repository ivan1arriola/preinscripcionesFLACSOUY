import type {
  SystemErrorRecord,
  ErrorStatus,
  ErrorOrigin,
  ErrorSeverity,
} from '../domain/system-error.js';

export interface FindErrorsFilter {
  status?: ErrorStatus;
  origin?: ErrorOrigin;
  severity?: ErrorSeverity;
  targetId?: string;
  limit?: number;
}

export interface SystemErrorRepository {
  save(error: SystemErrorRecord): Promise<void>;
  findById(id: string): Promise<SystemErrorRecord | null>;
  findMany(filter?: FindErrorsFilter): Promise<SystemErrorRecord[]>;
  resolve(id: string, resolvedBy: string, now?: Date): Promise<SystemErrorRecord | null>;
}
