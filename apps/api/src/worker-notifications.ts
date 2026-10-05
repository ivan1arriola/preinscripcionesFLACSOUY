import { createKyselyDb } from './infrastructure/database/kysely.js';
import { PostgresSystemSettingsRepository } from './infrastructure/database/postgres-system-settings-repository.js';
import { EncryptedSettingsService } from './infrastructure/security/encrypted-settings.js';
import { PostgresEmailNotificationRepository } from './infrastructure/database/postgres-email-notification-repository.js';
import { loadEmailConfig } from './infrastructure/email/email-config.js';
import { SmtpEmailProvider } from './infrastructure/email/smtp-email-provider.js';
import { EmailNotificationDispatcher } from './application/email-notification-dispatcher.js';

console.log('[NotificationWorker] Iniciando worker de despacho de notificaciones por correo (SMTP)...');

const db = createKyselyDb();
const settingsRepo = new PostgresSystemSettingsRepository(db);
const encryptedSettingsService = new EncryptedSettingsService(
  settingsRepo,
  process.env.APP_SETTINGS_ENCRYPTION_KEY
);
const notificationRepo = new PostgresEmailNotificationRepository(db);

const dispatcher = new EmailNotificationDispatcher({
  repository: notificationRepo,
  getProvider: async () => {
    try {
      const emailConfig = await loadEmailConfig(encryptedSettingsService);
      if (emailConfig.enabled && emailConfig.provider === 'smtp' && emailConfig.smtp) {
        return new SmtpEmailProvider(emailConfig.smtp);
      }
      return null;
    } catch (err) {
      console.warn('[NotificationWorker] Configuración de correo no disponible o inválida:', err instanceof Error ? err.message : err);
      return null;
    }
  },
  batchSize: 10,
  maxAttempts: 5,
  leaseDurationMs: 300_000,
});

dispatcher.start(10_000);

async function shutdown() {
  console.log('[NotificationWorker] Deteniendo worker...');
  await dispatcher.stop();
  await db.destroy();
  console.log('[NotificationWorker] Worker detenido.');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
