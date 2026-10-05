export type TelegramAlertStatus = 'pending' | 'processing' | 'sent' | 'failed';
export type TelegramEventType = 'recovery' | 'preinscription';

export interface TelegramAlertRecord {
  id: string;
  recoveryId?: string | null;
  submissionId: string;
  chatId: string;
  eventType: TelegramEventType;
  dedupeKey: string;
  message: string;
  status: TelegramAlertStatus;
  attemptCount: number;
  maxAttempts: number;
  availableAt: Date;
  lockedUntil?: Date | null;
  lockedBy?: string | null;
  providerMessageId?: string | null;
  lastError?: string | null;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueTelegramAlertInput {
  recoveryId?: string | null;
  submissionId: string;
  chatId: string;
  message: string;
  eventType?: TelegramEventType;
  dedupeKey?: string;
  availableAt?: Date;
  maxAttempts?: number;
}

export interface TelegramAlertCounts {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  total: number;
}

export interface TelegramAlertFilter {
  status?: TelegramAlertStatus;
  submissionId?: string;
  eventType?: TelegramEventType;
  limit?: number;
  offset?: number;
}

export interface TelegramAlertRepository {
  enqueue(input: EnqueueTelegramAlertInput | EnqueueTelegramAlertInput[]): Promise<TelegramAlertRecord[]>;
  ensureForSubmission(input: EnqueueTelegramAlertInput | EnqueueTelegramAlertInput[]): Promise<TelegramAlertRecord[]>;
  claimPending(limit: number, now: Date, leaseDurationMs?: number, lockedBy?: string): Promise<TelegramAlertRecord[]>;
  markSent(id: string, providerMessageId?: string, now?: Date): Promise<void>;
  markRetryableFailure(id: string, error: string, availableAt: Date, now?: Date): Promise<void>;
  markPermanentFailure(id: string, error: string, now?: Date): Promise<void>;
  getCounts(): Promise<TelegramAlertCounts>;
  listAlerts?(filter?: TelegramAlertFilter): Promise<TelegramAlertRecord[]>;
  findById?(id: string): Promise<TelegramAlertRecord | null>;
}
