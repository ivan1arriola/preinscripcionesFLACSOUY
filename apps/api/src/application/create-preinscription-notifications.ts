import type { AcademicTarget, FormDefinition } from '@flacso/contracts';
import {
  buildSubmissionNotificationSnapshot,
  type NotificationAudience,
} from './notification-snapshot.js';
import type {
  EmailNotificationRepository,
  EmailNotificationRecord,
} from '../ports/email-notification-repository.js';

export interface CreateNotificationsInput {
  submissionId: string;
  target: AcademicTarget;
  form: FormDefinition;
  values: Record<string, string>;
  spreadsheetRowUrl: string;
  documentsFolderUrl: string;
  masterRecipients: string[];
}

export function buildNotificationRecipients(
  applicantEmail?: string,
  targetEmails: string[] = [],
  masterRecipients: string[] = []
): Array<{ audience: NotificationAudience; email: string }> {
  const recipients: Array<{ audience: NotificationAudience; email: string }> = [];
  const seenEmails = new Set<string>();

  // 1. Applicant
  if (applicantEmail && applicantEmail.trim().length > 0) {
    const normalized = applicantEmail.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      recipients.push({ audience: 'applicant', email: normalized });
    }
  }

  // 2. Target operational emails ("Correo de la Oferta Académica", deduplicated)
  for (const targetEmail of targetEmails) {
    if (!targetEmail || !targetEmail.trim()) continue;
    const normalized = targetEmail.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && !seenEmails.has(normalized)) {
      recipients.push({ audience: 'target', email: normalized });
      seenEmails.add(normalized);
    }
  }

  // 3. Master emails (deduplicated against target and other masters)
  for (const master of masterRecipients) {
    if (!master || !master.trim()) continue;
    const normalized = master.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && !seenEmails.has(normalized)) {
      recipients.push({ audience: 'master', email: normalized });
      seenEmails.add(normalized);
    }
  }

  return recipients;
}

export async function createPreinscriptionNotifications(
  repository: EmailNotificationRepository,
  input: CreateNotificationsInput
): Promise<EmailNotificationRecord[]> {
  const snapshot = buildSubmissionNotificationSnapshot({
    submissionId: input.submissionId,
    target: input.target,
    fields: [
      ...input.form.inputs.map((inp) => ({ key: inp.key, label: inp.label, type: inp.type, required: inp.required })),
      ...(input.form.documents ?? []).map((doc) => ({ key: doc.key, label: doc.label, type: 'file', required: doc.required })),
    ],
    payload: input.values,
    spreadsheetRowUrl: input.spreadsheetRowUrl,
    documentsFolderUrl: input.documentsFolderUrl,
  });

  const recipients = buildNotificationRecipients(
    snapshot.applicantEmail,
    snapshot.notificationEmails,
    input.masterRecipients
  );

  return await repository.ensureForSubmission({
    submissionId: input.submissionId,
    snapshot,
    recipients,
  });
}
