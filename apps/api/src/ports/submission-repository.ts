import type { SubmissionFileToken } from '@flacso/contracts';
import type { CampaignTrackingRecord, CampaignTrackingRow } from '../domain/campaign-tracking.js';
import type { MauticContactSync } from '../domain/mautic-contact.js';
import type { MauticEnrollmentNotice } from '../domain/mautic-enrollment.js';

export interface ValidatedSubmissionRecord {
  clientSubmissionId?: string;
  targetId: string;
  configRevision: string;
  targetTitle: string;
  targetKind: string;
  values: Record<string, string>;
  files?: SubmissionFileToken[];
  /** Registro de seguimiento de campañas; se guarda en la misma transacción que la preinscripción. */
  campaignTracking?: CampaignTrackingRecord;
  profileVersionId?: string | null;
  profileSnapshot?: unknown | null;
  /** 'cached' cuando WordPress no respondió y se validó contra el catálogo guardado. */
  catalogValidation?: 'live' | 'cached';
  /** Si está presente, se encola la sincronización del contacto con Mautic en la misma transacción. */
  mauticContact?: MauticContactSync | null;
  /** Si está presente, se encola el aviso de inscripción a Mautic en la misma transacción. */
  mauticEnrollment?: MauticEnrollmentNotice | null;
}

export interface SavedSubmissionResult {
  id: string;
  existing: boolean;
  /** Dueño del lease con el que nació la fila de procesamiento (solo en envíos nuevos). */
  leaseOwner?: string;
}

export interface SubmissionRepository {
  save(submission: ValidatedSubmissionRecord): Promise<SavedSubmissionResult>;
  saveOrGet(submission: ValidatedSubmissionRecord): Promise<SavedSubmissionResult>;
  /** Permite reconocer un reintento (mismo clientSubmissionId) antes de repetir validaciones y efectos. */
  findByClientSubmissionId?(clientSubmissionId: string): Promise<{ id: string } | null>;
  /** Seguimiento de campañas en el rango [from, to] (`from`/`to` son el inicio de un día de Montevideo; `to` queda incluido entero), más nuevo primero. */
  listCampaignTracking?(range: { from?: Date; to?: Date }): Promise<CampaignTrackingRow[]>;
  /** Registra conjuntamente la finalización y la tarea recuperable de correo. */
  markSuccessWithNotificationIntent?(id: string, links: { targetId: string; spreadsheetUrl: string; documentsFolderUrl: string }): Promise<string>;
  markProcessing(id: string, status: 'pending' | 'success' | 'failed' | 'unknown', errorMessage?: string): Promise<void>;
  markFileStored(token: string, driveFileId: string): Promise<void>;
  markFileFailed(token: string, errorMessage: string): Promise<void>;
  getReservedDriveFileId?(token: string): Promise<string | null>;
  reserveDriveFileId?(token: string, driveReservedId: string): Promise<string>;
  recordProcessingFailure?(
    id: string,
    stage: 'drive' | 'sheets' | 'notifications' | 'unknown',
    safeError: string,
    retentionDays?: number
  ): Promise<void>;
}
