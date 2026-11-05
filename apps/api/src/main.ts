import { createApp } from './presentation/http/app.js';
import { FixtureAcademicCatalog } from './infrastructure/fixtures/fixture-academic-catalog.js';
import { PostgresSubmissionRepository } from './infrastructure/database/postgres-submission-repository.js';
import { PostgresSystemSettingsRepository } from './infrastructure/database/postgres-system-settings-repository.js';
import { createKyselyDb } from './infrastructure/database/kysely.js';
import { runMigrations } from './infrastructure/database/migrate.js';
import { sql } from 'kysely';

import { WordPressClient } from './infrastructure/wordpress/wordpress-client.js';
import { catalogHealthResponse, type CatalogHealthResponse } from './presentation/http/health.js';
import { WordPressAcademicCatalog } from './infrastructure/wordpress/wordpress-academic-catalog.js';
import { RegisteredLinkAcademicCatalog } from './application/registered-link-catalog.js';
import { PostgresOfferRegistrationLinkRepository } from './infrastructure/database/postgres-offer-registration-link-repository.js';
import { PostgresWordPressCache } from './infrastructure/wordpress/wordpress-cache.js';
import { TemporaryFileStorage } from './infrastructure/files/temporary-file-storage.js';
import { GoogleDriveRepository } from './infrastructure/google/google-drive-repository.js';
import { GoogleSheetsRepository } from './infrastructure/google/google-sheets-repository.js';
import { HttpGoogleSheetsClient } from './infrastructure/google/sheets-client.js';
import { GoogleSpreadsheetProvisioner } from './infrastructure/google/google-spreadsheet-provisioner.js';
import { loadAllGoogleCredentials } from './infrastructure/google/google-credentials.js';
import { GoogleIdentityVerifier } from './infrastructure/auth/google-oidc.js';
import { PostgresTargetSpreadsheetRepository } from './infrastructure/database/postgres-target-spreadsheet-repository.js';
import { TargetSpreadsheetService } from './application/target-spreadsheet-service.js';
import { PostgresAdminSessionStore } from './infrastructure/database/postgres-admin-session-store.js';
import { getAdminSessionTtlMs } from './application/admin-session.js';
import { EncryptedSettingsService } from './infrastructure/security/encrypted-settings.js';
import { PostgresEmailNotificationRepository } from './infrastructure/database/postgres-email-notification-repository.js';
import { PostgresSubmissionRecoveryRepository } from './infrastructure/database/postgres-submission-recovery-repository.js';
import { PostgresTelegramAlertRepository } from './infrastructure/database/postgres-telegram-alert-repository.js';
import { EmailNotificationDispatcher } from './application/email-notification-dispatcher.js';
import { TelegramRecoveryAlertDispatcher } from './application/telegram-recovery-alert-dispatcher.js';
import { MauticContactSyncDispatcher } from './application/mautic-contact-sync-dispatcher.js';
import { MauticEnrollmentNotifyDispatcher } from './application/mautic-enrollment-notify-dispatcher.js';
import { createMauticClientCache, enrollmentWebhook, hasMauticCredentials, loadMauticConfig } from './infrastructure/mautic/mautic-config.js';
import { createEmailProviderResolver } from './infrastructure/email/email-provider-resolver.js';
import { loadEmailConfig } from './infrastructure/email/email-config.js';
import { loadTelegramConfig } from './infrastructure/telegram/telegram-config.js';
import { FetchTelegramProvider } from './infrastructure/telegram/telegram-provider.js';
import { cleanupExpiredRecoveries } from './application/cleanup-expired-recoveries.js';
import { PostgresSubmissionProcessingRepository } from './infrastructure/database/postgres-submission-processing-repository.js';
import { sweepOnce } from './application/sweep-abandoned-submissions.js';
import { createSweepDependencies, newSweeperId } from './infrastructure/sweep-runtime.js';
import { purgeNotificationPersonalData } from './application/purge-notification-personal-data.js';

const port = Number(process.env.PORT || 3000);
const db = createKyselyDb();

const systemSettingsRepository = new PostgresSystemSettingsRepository(db);
const encryptedSettingsService = new EncryptedSettingsService(
  systemSettingsRepository,
  process.env.APP_SETTINGS_ENCRYPTION_KEY
);
const targetSpreadsheetRepository = new PostgresTargetSpreadsheetRepository(db);
const emailNotificationRepository = new PostgresEmailNotificationRepository(db);
const submissionRecoveryRepository = new PostgresSubmissionRecoveryRepository(db);
const telegramAlertRepository = new PostgresTelegramAlertRepository(db);

const wordPressClient = process.env.WORDPRESS_URL
  ? new WordPressClient({ baseUrl: process.env.WORDPRESS_URL, catalogToken: process.env.WORDPRESS_CATALOG_TOKEN })
  : undefined;
// El enlace de preinscripción de cada oferta se registra una sola vez y solo cambia si WordPress lo cambia.
const catalog = wordPressClient
  ? new RegisteredLinkAcademicCatalog(
      new WordPressAcademicCatalog(wordPressClient, new PostgresWordPressCache(db)),
      new PostgresOfferRegistrationLinkRepository(db)
    )
  : new FixtureAcademicCatalog();

// Consulta WordPress directo (sin la caché del catálogo) y recuerda el resultado 30 s,
// porque el endpoint es público y no debe poder usarse para castigar a WordPress.
const CATALOG_HEALTH_TTL_MS = 30_000;
let catalogHealthMemo: { at: number; value: CatalogHealthResponse } | undefined;
const checkCatalog = wordPressClient
  ? async (): Promise<CatalogHealthResponse> => {
      if (catalogHealthMemo && Date.now() - catalogHealthMemo.at < CATALOG_HEALTH_TTL_MS) return catalogHealthMemo.value;
      const tokenConfigured = Boolean(process.env.WORDPRESS_CATALOG_TOKEN?.trim());
      let value: CatalogHealthResponse;
      try {
        const response = await wordPressClient.getPreinscriptions();
        value = catalogHealthResponse({ tokenConfigured, result: { rejectedTargets: response.rejectedTargets?.length ?? 0 } });
      } catch (error) {
        value = catalogHealthResponse({ tokenConfigured, result: { error } });
      }
      catalogHealthMemo = { at: Date.now(), value };
      return value;
    }
  : undefined;

if (process.env.WORDPRESS_URL && !process.env.WORDPRESS_CATALOG_TOKEN?.trim()) {
  console.warn('[Catalog] WORDPRESS_CATALOG_TOKEN no configurado: no se notificará a los correos de las ofertas académicas.');
}

const repository = new PostgresSubmissionRepository(db);

const temporaryFileStorage = new TemporaryFileStorage({
  rootDir: process.env.UPLOAD_TMP_DIR || '/tmp/flacso-preinscripciones',
  maxBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
});
const googleCreds = loadAllGoogleCredentials();
if (process.env.NODE_ENV === 'production' && !googleCreds.tokenProvider) {
  throw new Error('Google no está configurado: se requiere la cuenta de servicio para crear Drive y Sheets por destino en producción.');
}
if (googleCreds.serviceAccountPath) {
  console.log(`[Google] Cuenta de servicio detectada: ${googleCreds.serviceAccountPath} (${googleCreds.clientEmail || 'sin email'})`);
} else if (process.env.GOOGLE_ACCESS_TOKEN) {
  console.log('[Google] Token manual configurado en GOOGLE_ACCESS_TOKEN');
} else {
  console.log('[Google] Sin credenciales de Google Service Account; usando simulador local en desarrollo');
}

const isMockDrive = process.env.GOOGLE_DRIVE_MOCK === 'true';

const googleDriveRepository = !isMockDrive && googleCreds.tokenProvider
  ? new GoogleDriveRepository({
      folderIdOrProvider: async () =>
        await (async () => {
          const configuredFolder = await systemSettingsRepository.getSetting('google_drive_folder_id');
          if (!configuredFolder) {
            throw new Error('La carpeta raíz de Google Drive todavía no está configurada desde el panel administrativo.');
          }
          return configuredFolder;
        })(),
      accessTokenOrProvider: googleCreds.tokenProvider,
    })
  : process.env.NODE_ENV !== 'production' || isMockDrive
  ? {
      storeSubmissionFiles: async (command: any) =>
        command.files.map((f: any, i: number) => ({
          token: f.token,
          driveFileId: `dev-drive-${i}`,
        })),
    }
  : undefined;

const googleSheetsClient = !isMockDrive && googleCreds.tokenProvider
  ? new HttpGoogleSheetsClient({ accessTokenOrProvider: googleCreds.tokenProvider })
  : undefined;

const googleSheetsRepository = googleSheetsClient
  ? new GoogleSheetsRepository(googleSheetsClient)
  : undefined;

const spreadsheetProvisioner = googleCreds.tokenProvider && googleSheetsClient
  ? new GoogleSpreadsheetProvisioner({
      accessTokenOrProvider: googleCreds.tokenProvider,
      sheetsClient: googleSheetsClient,
    })
  : undefined;

const targetSpreadsheetService = spreadsheetProvisioner
  ? new TargetSpreadsheetService(
      targetSpreadsheetRepository,
      spreadsheetProvisioner,
      async () => systemSettingsRepository.getSetting('google_drive_folder_id'),
      googleDriveRepository as any,
      undefined,
      googleSheetsRepository,
    )
  : undefined;

const googleIdentityVerifier = googleCreds.oauthConfig.clientId
  ? new GoogleIdentityVerifier({
      clientId: googleCreds.oauthConfig.clientId,
      clientSecret: googleCreds.oauthConfig.clientSecret,
    })
  : undefined;

if (googleIdentityVerifier) {
  console.log('[Google] Google OIDC verifier configurado para acceso administrativo');
} else {
  console.log('[Google] Google OIDC no configurado (falta archivo OAuth o variable GOOGLE_OIDC_CLIENT_ID)');
}

const checkDb = async () => {
  try {
    await sql`SELECT 1`.execute(db);
    return true;
  } catch {
    return false;
  }
};

// El fijado y la limpieza de archivos dependen de un rename atómico: si retained/ o deleting/ no comparten volumen
// con la raíz, el arranque falla en vez de funcionar sin la garantía de exclusión.
await temporaryFileStorage.assertSameVolume();

// Attempt migration on startup if database is accessible
try {
  await runMigrations(db);
} catch (err) {
  console.warn('Could not run migrations on startup (database might be initializing or degraded):', err);
}

const adminSessionStore = new PostgresAdminSessionStore(db, getAdminSessionTtlMs());

const resolveEmailProvider = createEmailProviderResolver();

const notificationDispatcher = new EmailNotificationDispatcher({
  repository: emailNotificationRepository,
  getProvider: async () => {
    try {
      return resolveEmailProvider(await loadEmailConfig(encryptedSettingsService));
    } catch (err) {
      console.warn('[Notification Dispatcher] Configuración de correo no disponible:', err instanceof Error ? err.message : err);
      return null;
    }
  },
});

if (process.env.NODE_ENV !== 'test') {
  notificationDispatcher.start(30_000);
}

const telegramAlertDispatcher = new TelegramRecoveryAlertDispatcher({
  repository: telegramAlertRepository,
  getProvider: async () => {
    try {
      const telegramConfig = await loadTelegramConfig(encryptedSettingsService);
      if ((telegramConfig.enabled || telegramConfig.preinscriptionEnabled) && telegramConfig.botToken) {
        return new FetchTelegramProvider(telegramConfig.botToken);
      }
      return null;
    } catch (err) {
      console.warn('[Telegram Dispatcher] Configuración de Telegram no disponible:', err instanceof Error ? err.message : err);
      return null;
    }
  },
});

if (process.env.NODE_ENV !== 'test') {
  telegramAlertDispatcher.start(15_000);
}

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
    await telegramAlertRepository.ensureForSubmission(telegramConfig.chatIds.map((chatId) => ({
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

const mauticEnrollmentNotifyDispatcher = new MauticEnrollmentNotifyDispatcher(db, {
  getWebhook: async () => {
    try {
      return enrollmentWebhook(await loadMauticConfig(encryptedSettingsService));
    } catch (err) {
      console.warn('[MauticEnrollments] Configuración de Mautic no disponible:', err instanceof Error ? err.message : err);
      return null;
    }
  },
  onPermanentFailure: async ({ submissionId, safeCode }) => {
    const telegramConfig = await loadTelegramConfig(encryptedSettingsService);
    if (!telegramConfig.enabled) return;
    await telegramAlertRepository.ensureForSubmission(telegramConfig.chatIds.map((chatId) => ({
      submissionId,
      chatId,
      eventType: 'recovery' as const,
      dedupeKey: `${submissionId}:${chatId}:mautic_enrollment_failed`,
      message: [
        '⚠️ No se pudo avisar la inscripción a Mautic: el postulante puede seguir recibiendo la campaña de la oferta',
        `ID: ${submissionId}`,
        `Motivo: ${safeCode}`,
        'Revisar la URL de Mautic y el secreto del aviso (mautic_enrollment_notify).',
      ].join('\n'),
    })));
  },
});

if (process.env.NODE_ENV !== 'test') {
  mauticContactSyncDispatcher.start(10_000);
  mauticEnrollmentNotifyDispatcher.start(10_000);
}

const app = createApp({
  catalog,
  repository,
  submissionLease: { repository: new PostgresSubmissionProcessingRepository(db) },
  temporaryFileStorage,
  googleDriveRepository,
  spreadsheetRepository: googleSheetsRepository,
  targetSpreadsheetService,
  targetSpreadsheetRepository,
  googleIdentityVerifier,
  adminSessionStore,
  systemSettingsRepository,
  encryptedSettingsService,
  emailNotificationRepository,
  emailNotificationDispatcher: notificationDispatcher,
  submissionRecoveryRepository,
  telegramAlertRepository,
  serviceAccountEmail: googleCreds.clientEmail,
  checkDatabase: checkDb,
  checkCatalog,
});

// Barrido de envíos abandonados y tareas diferidas (P4). Apagado por defecto: se enciende con
// SUBMISSION_SWEEPER_ENABLED=true una vez verificado con `pnpm --filter api sweep:once --dry-run`.
const sweeperEnabled = process.env.SUBMISSION_SWEEPER_ENABLED === 'true';
const sweeperId = newSweeperId();
let sweeping = false;
const sweeperInterval = sweeperEnabled
  ? setInterval(async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        const summary = await sweepOnce(createSweepDependencies(db, submissionRecoveryRepository), { owner: sweeperId, now: new Date() });
        if (summary.abandoned.length > 0 || summary.dueTasks > 0 || summary.errors.length > 0) {
          console.log(`[Sweeper] ${summary.abandoned.length} envío(s) abandonado(s), ${summary.dueTasks} tarea(s), ${summary.errors.length} error(es).`);
        }
      } catch (err) {
        console.error('[Sweeper] Error en el barrido:', err instanceof Error ? err.message : err);
      } finally {
        sweeping = false;
      }
    }, 60_000)
  : undefined;
sweeperInterval?.unref();
if (sweeperEnabled) console.log('[Sweeper] Barrido de envíos abandonados habilitado.');

const cleanupInterval = setInterval(async () => {
  try {
    const result = await cleanupExpiredRecoveries({
      recoveryRepository: submissionRecoveryRepository,
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
    const redacted = await purgeNotificationPersonalData({ repository: emailNotificationRepository });
    if (redacted > 0) {
      console.log(`[Cleanup] Se eliminaron los datos personales de ${redacted} notificación(es) enviada(s) fuera del plazo de retención.`);
    }
  } catch (err) {
    console.error('[Cleanup] Error al aplicar la retención de datos de las notificaciones:', err);
  }

  try {
    const expiredSessions = await adminSessionStore.cleanExpiredSessions();
    if (expiredSessions > 0) {
      console.log(`[Cleanup] Se eliminaron ${expiredSessions} sesión(es) administrativa(s) vencida(s).`);
    }
  } catch (err) {
    console.error('[Cleanup] Error al purgar sesiones administrativas vencidas:', err);
  }
}, 15 * 60 * 1000);
cleanupInterval.unref();

// Un rechazo sin manejar (p. ej. un corte momentáneo de PostgreSQL) no debe tumbar el servidor y cortar
// los envíos en curso; una excepción no capturada deja el proceso en estado indefinido y sí lo reinicia.
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Promesa rechazada sin manejar:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (error) => {
  console.error('[Process] Excepción no capturada, se reinicia el servicio:', error);
  process.exit(1);
});

const server = app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});

// Apagado ordenado: deja terminar las peticiones en curso (envíos con Drive/Sheets) antes de cerrar.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Process] ${signal} recibido: cerrando el servidor...`);
  if (sweeperInterval) clearInterval(sweeperInterval);
  const forceExit = setTimeout(() => process.exit(1), 25_000);
  forceExit.unref();
  server.close(async () => {
    try {
      await db.destroy();
    } finally {
      process.exit(0);
    }
  });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
