import { createApp } from './presentation/http/app.js';
import { FixtureAcademicCatalog } from './infrastructure/fixtures/fixture-academic-catalog.js';
import { PostgresSubmissionRepository } from './infrastructure/database/postgres-submission-repository.js';
import { PostgresFormProfileRepository } from './infrastructure/database/postgres-form-profile-repository.js';
import { PostgresSystemSettingsRepository } from './infrastructure/database/postgres-system-settings-repository.js';
import { createKyselyDb } from './infrastructure/database/kysely.js';
import { runMigrations } from './infrastructure/database/migrate.js';
import { sql } from 'kysely';

import { WordPressClient } from './infrastructure/wordpress/wordpress-client.js';
import { WordPressAcademicCatalog } from './infrastructure/wordpress/wordpress-academic-catalog.js';
import { PostgresWordPressCache } from './infrastructure/wordpress/wordpress-cache.js';
import { TemporaryFileStorage } from './infrastructure/files/temporary-file-storage.js';
import { GoogleDriveRepository } from './infrastructure/google/google-drive-repository.js';
import { loadAllGoogleCredentials } from './infrastructure/google/google-credentials.js';
import { GoogleIdentityVerifier } from './infrastructure/auth/google-oidc.js';


const port = Number(process.env.PORT || 3000);
const db = createKyselyDb();

const formProfileRepository = new PostgresFormProfileRepository(db);
const systemSettingsRepository = new PostgresSystemSettingsRepository(db);

const catalog = process.env.WORDPRESS_URL
  ? new WordPressAcademicCatalog(
      new WordPressClient({ baseUrl: process.env.WORDPRESS_URL }),
      new PostgresWordPressCache(db)
    )
  : new FixtureAcademicCatalog();

const repository = new PostgresSubmissionRepository(db);

const temporaryFileStorage = new TemporaryFileStorage({
  rootDir: process.env.UPLOAD_TMP_DIR || '/tmp/flacso-preinscripciones',
  maxBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
});
const googleCreds = loadAllGoogleCredentials();
const defaultDriveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e';

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
        (await systemSettingsRepository.getSetting('google_drive_folder_id')) || defaultDriveFolderId,
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

const app = createApp({
  catalog,
  repository,
  temporaryFileStorage,
  googleDriveRepository,
  formProfileRepository,
  googleIdentityVerifier,
  systemSettingsRepository,
  serviceAccountEmail: googleCreds.clientEmail,
  checkDatabase: checkDb,
});

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
