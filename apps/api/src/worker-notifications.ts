import { createKyselyDb } from './infrastructure/database/kysely.js';
import { PostgresSystemSettingsRepository } from './infrastructure/database/postgres-system-settings-repository.js';
import { EncryptedSettingsService } from './infrastructure/security/encrypted-settings.js';
import { PostgresEmailNotificationRepository } from './infrastructure/database/postgres-email-notification-repository.js';
import { PostgresTelegramAlertRepository } from './infrastructure/database/postgres-telegram-alert-repository.js';
import { PostgresSubmissionRecoveryRepository } from './infrastructure/database/postgres-submission-recovery-repository.js';
import { TemporaryFileStorage } from './infrastructure/files/temporary-file-storage.js';
import { loadEmailConfig } from './infrastructure/email/email-config.js';
import { createEmailProviderResolver } from './infrastructure/email/email-provider-resolver.js';
import { createMauticClientCache, hasMauticCredentials, loadMauticConfig } from './infrastructure/mautic/mautic-config.js';
import { MauticContactSyncDispatcher } from './application/mautic-contact-sync-dispatcher.js';
import { EmailNotificationDispatcher } from './application/email-notification-dispatcher.js';
import { loadTelegramConfig } from './infrastructure/telegram/telegram-config.js';
import { FetchTelegramProvider } from './infrastructure/telegram/telegram-provider.js';
import { TelegramRecoveryAlertDispatcher } from './application/telegram-recovery-alert-dispatcher.js';
import { cleanupExpiredRecoveries } from './application/cleanup-expired-recoveries.js';
import { purgeNotificationPersonalData } from './application/purge-notification-personal-data.js';

console.log('[Worker] Iniciando worker de despacho de notificaciones (SMTP, Telegram) y retención...');

const db = createKyselyDb();
const settingsRepo = new PostgresSystemSettingsRepository(db);
const encryptedSettingsService = new EncryptedSettingsService(
  settingsRepo,
  process.env.APP_SETTINGS_ENCRYPTION_KEY
);
const notificationRepo = new PostgresEmailNotificationRepository(db);
const telegramAlertRepo = new PostgresTelegramAlertRepository(db);
const recoveryRepo = new PostgresSubmissionRecoveryRepository(db);

const temporaryFileStorage = new TemporaryFileStorage({
  rootDir: process.env.UPLOAD_TMP_DIR || '/tmp/flacso-preinscripciones',
  maxBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
});

const resolveEmailProvider = createEmailProviderResolver();

const emailDispatcher = new EmailNotificationDispatcher({
  repository: notificationRepo,
  getProvider: async () => {
    try {
      const emailConfig = await loadEmailConfig(encryptedSettingsService);
      // El worker nunca usa el proveedor 'fake' de desarrollo.
      return emailConfig.provider === 'fake' ? null : resolveEmailProvider(emailConfig);
    } catch (err) {
      console.warn('[NotificationWorker] Configuración de correo no disponible o inválida:', err instanceof Error ? err.message : err);
      return null;
    }
  },
  batchSize: 10,
  maxAttempts: 5,
  leaseDurationMs: 300_000,
});

const telegramDispatcher = new TelegramRecoveryAlertDispatcher({
  repository: telegramAlertRepo,
  getProvider: async () => {
    try {
      const telegramConfig = await loadTelegramConfig(encryptedSettingsService);
      if ((telegramConfig.enabled || telegramConfig.preinscriptionEnabled) && telegramConfig.botToken) {
        return new FetchTelegramProvider(telegramConfig.botToken);
      }
      return null;
    } catch (err) {
      console.warn('[TelegramWorker] Configuración de Telegram no disponible o inválida:', err instanceof Error ? err.message : err);
      return null;
    }
  },
  batchSize: 10,
  leaseDurationMs: 300_000,
});

emailDispatcher.start(10_000);
telegramDispatcher.start(15_000);

const mauticClientFor = createMauticClientCache();
const mauticContactSyncDispatcher = new MauticContactSyncDispatcher(db, {
  getClient: async () => {
    try {
      const config = await loadMauticConfig(encryptedSettingsService);
      return hasMauticCredentials(config) ? mauticClientFor(config) : null;
    } catch (err) {
      console.warn('[MauticContacts] Configuración de Mautic no disponible:', err instanceof Error ? err.message : err);
      return null;
    }
  },
  onPermanentFailure: async ({ submissionId, safeCode }) => {
    const telegramConfig = await loadTelegramConfig(encryptedSettingsService);
    if (!telegramConfig.enabled) return;
    await telegramAlertRepo.ensureForSubmission(telegramConfig.chatIds.map((chatId) => ({
      submissionId,
      chatId,
      eventType: 'recovery' as const,
      dedupeKey: `${submissionId}:${chatId}:mautic_contact_failed`,
      message: [
        '⚠️ No se pudo registrar el contacto del postulante en Mautic',
        `ID: ${submissionId}`,
        `Motivo: ${safeCode}`,
        'Revisar la configuración de Mautic (mautic_contact_sync).',
      ].join('\n'),
    })));
  },
});
const stopMauticContactSync = mauticContactSyncDispatcher.start(10_000);

const cleanupInterval = setInterval(async () => {
  try {
    const result = await cleanupExpiredRecoveries({
      recoveryRepository: recoveryRepo,
      fileStorage: temporaryFileStorage,
    });
    if (result.deletedRecoveries > 0 || result.removedFiles > 0) {
      console.log(
        `[Cleanup] Limpieza automática eliminó ${result.deletedRecoveries} registro(s) de recuperación y ${result.removedFiles} archivo(s) temporales vencidos.`
      );
    }
  } catch (err) {
    console.error('[Cleanup] Error en la limpieza automática de recuperaciones y archivos temporales:', err);
  }

  try {
    await purgeNotificationPersonalData({ repository: notificationRepo });
  } catch (err) {
    console.error('[Cleanup] Error al aplicar la retención de datos de las notificaciones:', err);
  }
}, 15 * 60 * 1000);
cleanupInterval.unref();

async function shutdown() {
  console.log('[Worker] Deteniendo worker...');
  clearInterval(cleanupInterval);
  emailDispatcher.stop();
  telegramDispatcher.stop();
  stopMauticContactSync();
  await db.destroy();
  console.log('[Worker] Worker detenido.');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
