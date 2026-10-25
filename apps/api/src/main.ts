import { createApp } from './presentation/http/app.js';
import { FixtureAcademicCatalog } from './infrastructure/fixtures/fixture-academic-catalog.js';
import { PostgresSubmissionRepository } from './infrastructure/database/postgres-submission-repository.js';
import { PostgresSystemSettingsRepository } from './infrastructure/database/postgres-system-settings-repository.js';
import { createKyselyDb } from './infrastructure/database/kysely.js';
import { runMigrations } from './infrastructure/database/migrate.js';
import { sql } from 'kysely';

import { WordPressClient } from './infrastructure/wordpress/wordpress-client.js';
import { WordPressAcademicCatalog } from './infrastructure/wordpress/wordpress-academic-catalog.js';
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
import { createEmailProviderResolver } from './infrastructure/email/email-provider-resolver.js';
import { loadEmailConfig } from './infrastructure/email/email-config.js';
import { loadTelegramConfig } from './infrastructure/telegram/telegram-config.js';
import { FetchTelegramProvider } from './infrastructure/telegram/telegram-provider.js';
import { cleanupExpiredRecoveries } from './application/cleanup-expired-recoveries.js';

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

const catalog = process.env.WORDPRESS_URL
  ? new WordPressAcademicCatalog(
      new WordPressClient({ baseUrl: process.env.WORDPRESS_URL, catalogToken: process.env.WORDPRESS_CATALOG_TOKEN }),
      new PostgresWordPressCache(db)
    )
  : new FixtureAcademicCatalog();

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

const app = createApp({
  catalog,
  repository,
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
});

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
}, 15 * 60 * 1000);
cleanupInterval.unref();

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
