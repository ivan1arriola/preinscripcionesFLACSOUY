import type { AcademicTarget } from '@flacso/contracts';
import type {
  TelegramAlertRecord,
  TelegramAlertRepository,
} from '../ports/telegram-alert-repository.js';

export interface BuildPreinscriptionTelegramMessageInput {
  submissionId: string;
  targetTitle: string;
  targetKind: 'offer' | 'seminar' | string;
  /** Nombre completo del postulante; no se incluye ningún otro dato personal. */
  applicantName?: string;
  occurredAt?: Date;
  catalogValidation?: 'live' | 'cached';
}

/** Nombres y apellidos del formulario, en el orden en que se leen. Vacío si no hay ninguno. */
export function applicantNameFromValues(values: Record<string, string | undefined> | undefined): string {
  if (!values) return '';
  return [values.nombre1, values.nombre2, values.apellido1, values.apellido2]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '' && part !== '-')
    .join(' ');
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
  const applicantName = input.applicantName?.trim().slice(0, 120);

  return [
    '✅ Nueva preinscripción recibida',
    `ID: ${input.submissionId}`,
    ...(applicantName ? [`Nombre: ${applicantName}`] : []),
    `Destino: ${truncatedTitle}`,
    `Tipo: ${typeLabel}`,
    `Fecha: ${formattedDate}`,
    'Estado: Registrada',
    ...(input.catalogValidation === 'cached'
      ? ['⚠️ WordPress no respondía: se validó contra el catálogo guardado. Revisar que la convocatoria siga abierta.']
      : []),
  ].join('\n');
}

export interface EnqueuePreinscriptionTelegramNotificationsInput {
  repository: TelegramAlertRepository;
  submissionId: string;
  target: AcademicTarget;
  chatIds: string[];
  applicantName?: string;
  occurredAt?: Date;
  catalogValidation?: 'live' | 'cached';
}

export async function enqueuePreinscriptionTelegramNotifications(
  input: EnqueuePreinscriptionTelegramNotificationsInput
): Promise<TelegramAlertRecord[]> {
  const { repository, submissionId, target, chatIds, applicantName, occurredAt = new Date(), catalogValidation } = input;
  if (!chatIds || chatIds.length === 0) {
    return [];
  }

  const message = buildPreinscriptionTelegramMessage({
    submissionId,
    targetTitle: target.title,
    targetKind: target.kind,
    applicantName,
    occurredAt,
    catalogValidation,
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
