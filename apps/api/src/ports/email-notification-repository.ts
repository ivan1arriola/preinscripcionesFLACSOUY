import type { SubmissionNotificationSnapshot, NotificationAudience } from '../application/notification-snapshot.js';

export type NotificationStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'unknown';

export interface EmailNotificationRecord {
  id: string;
  submissionId: string;
  audience: NotificationAudience;
  recipientEmail: string;
  targetId: string;
  templateVersion: string;
  payload: SubmissionNotificationSnapshot;
  status: NotificationStatus;
  attemptCount: number;
  providerMessageId?: string;
  lastError?: string;
  availableAt: Date;
  lockedUntil?: Date;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnsureEmailNotificationsInput {
  submissionId: string;
  snapshot: SubmissionNotificationSnapshot;
  recipients: Array<{ audience: NotificationAudience; email: string }>;
  availableAt?: Date;
}

export interface EmailNotificationFilter {
  status?: NotificationStatus;
  submissionId?: string;
  limit?: number;
  offset?: number;
}

export interface EmailNotificationRepository {
  ensureForSubmission(input: EnsureEmailNotificationsInput): Promise<EmailNotificationRecord[]>;
  claimPending(limit: number, now: Date, leaseDurationMs?: number): Promise<EmailNotificationRecord[]>;
  markSent(id: string, providerMessageId: string, now: Date): Promise<void>;
  markRetryableFailure(id: string, error: string, availableAt: Date): Promise<void>;
  markPermanentFailure(id: string, error: string, now: Date): Promise<void>;
  markUnknown(id: string, error: string): Promise<void>;
  listMissingForSuccessfulSubmissions(limit: number): Promise<string[]>;
  listNotifications?(filter?: EmailNotificationFilter): Promise<EmailNotificationRecord[]>;
  findById?(id: string): Promise<EmailNotificationRecord | null>;
  resetForManualRetry?(id: string, now: Date): Promise<void>;
}
