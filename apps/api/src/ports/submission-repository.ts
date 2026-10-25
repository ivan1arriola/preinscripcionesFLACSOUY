import type { SubmissionFileToken } from '@flacso/contracts';
import type { MauticContactSync } from '../domain/mautic-contact.js';

export interface ValidatedSubmissionRecord {
  clientSubmissionId?: string;
  targetId: string;
  configRevision: string;
  targetTitle: string;
  targetKind: string;
  values: Record<string, string>;
  files?: SubmissionFileToken[];
  profileVersionId?: string | null;
  profileSnapshot?: unknown | null;
  /** 'cached' cuando WordPress no respondió y se validó contra el catálogo guardado. */
  catalogValidation?: 'live' | 'cached';
  /** Si está presente, se encola la sincronización del contacto con Mautic en la misma transacción. */
  mauticContact?: MauticContactSync | null;
}

export interface SavedSubmissionResult {
  id: string;
  existing: boolean;
}

export interface SubmissionRepository {
  save(submission: ValidatedSubmissionRecord): Promise<SavedSubmissionResult>;
  saveOrGet(submission: ValidatedSubmissionRecord): Promise<SavedSubmissionResult>;
  markProcessing(id: string, status: 'pending' | 'success' | 'failed' | 'unknown', errorMessage?: string): Promise<void>;
  markFileStored(token: string, driveFileId: string): Promise<void>;
  markFileFailed(token: string, errorMessage: string): Promise<void>;
  recordProcessingFailure?(
    id: string,
    stage: 'drive' | 'sheets' | 'notifications' | 'unknown',
    safeError: string,
    retentionDays?: number
  ): Promise<void>;
}
