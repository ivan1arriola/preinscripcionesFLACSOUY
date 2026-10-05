import type { AcademicTarget } from '@flacso/contracts';
import type {
  TelegramAlertRecord,
  TelegramAlertRepository,
} from '../ports/telegram-alert-repository.js';

export interface BuildPreinscriptionTelegramMessageInput {
  submissionId: string;
  targetTitle: string;
  targetKind: 'offer' | 'seminar' | string;
  occurredAt?: Date;
}

export function buildPreinscriptionTelegramMessage(
  input: BuildPreinscriptionTelegramMessageInput
): string {
  const maxTitleLength = 100;
  const rawTitle = input.targetTitle.trim();
  const truncatedTitle =
    rawTitle.length > maxTitleLength
      ? `${rawTitle.slice(0, maxTitleLength - 3)}...`
      : rawTitle;

  const isSeminar = input.targetKind === 'seminar';
  const typeLabel = isSeminar ? 'Seminario' : 'Oferta académica';
  const occurredAt = input.occurredAt ?? new Date();
  const formattedDate = occurredAt.toISOString();

  return [
    '✅ Nueva preinscripción recibida',
    `ID: ${input.submissionId}`,
    `Destino: ${truncatedTitle}`,
    `Tipo: ${typeLabel}`,
    `Fecha: ${formattedDate}`,
    'Estado: Registrada',
  ].join('\n');
}

export interface EnqueuePreinscriptionTelegramNotificationsInput {
  repository: TelegramAlertRepository;
  submissionId: string;
  target: AcademicTarget;
  chatIds: string[];
  occurredAt?: Date;
}

export async function enqueuePreinscriptionTelegramNotifications(
  input: EnqueuePreinscriptionTelegramNotificationsInput
): Promise<TelegramAlertRecord[]> {
  const { repository, submissionId, target, chatIds, occurredAt = new Date() } = input;
  if (!chatIds || chatIds.length === 0) {
    return [];
  }

  const message = buildPreinscriptionTelegramMessage({
    submissionId,
    targetTitle: target.title,
    targetKind: target.kind,
    occurredAt,
  });

  const inputs = chatIds.map((chatId) => ({
    submissionId,
    chatId,
    eventType: 'preinscription' as const,
    dedupeKey: `${submissionId}:${chatId}:preinscription`,
    message,
    availableAt: occurredAt,
  }));

  return await repository.ensureForSubmission(inputs);
}
