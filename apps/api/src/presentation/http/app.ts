import express, { type Express } from 'express';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import { healthResponse } from './health.js';
import { createTargetRoutes } from './target-routes.js';
import { createSubmissionRoutes } from './submission-routes.js';
import { errorHandler } from './error-handler.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import { createUploadRoutes } from './upload-routes.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import type { SubmissionRecoveryRepository } from '../../ports/submission-recovery-repository.js';

import cookieParser from 'cookie-parser';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';
import {
  MemoryAdminSessionStore,
  type AdminSessionStore,
} from '../../application/admin-session.js';
import {
  createAdminAuthRoutes,
  createAdminMeRoute,
} from './admin-auth-routes.js';
import type { SystemSettingsRepository } from '../../ports/system-settings-repository.js';
import { MemorySystemSettingsRepository } from '../../infrastructure/fixtures/memory-system-settings-repository.js';
import { createAdminSettingsRoutes } from './admin-settings-routes.js';
import type { TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';
import type { TargetSpreadsheetRepository } from '../../ports/target-spreadsheet-repository.js';
import { EncryptedSettingsService } from '../../infrastructure/security/encrypted-settings.js';
import type { EmailNotificationRepository } from '../../ports/email-notification-repository.js';
import type { EmailNotificationDispatcher } from '../../application/email-notification-dispatcher.js';
import { loadEmailConfig, type SmtpConfig } from '../../infrastructure/email/email-config.js';
import type { EmailProvider } from '../../infrastructure/email/email-provider.js';
import type { TelegramAlertRepository } from '../../ports/telegram-alert-repository.js';
import { loadTelegramConfig } from '../../infrastructure/telegram/telegram-config.js';

export interface AppDependencies {
  catalog: AcademicCatalog;
  repository: SubmissionRepository;
  checkDatabase?: () => Promise<boolean>;
  temporaryFileStorage?: TemporaryFileStoragePort;
  googleDriveRepository?: GoogleDriveRepositoryPort;
  spreadsheetRepository?: SpreadsheetRepository;
  targetSpreadsheetService?: TargetSpreadsheetService;
  targetSpreadsheetRepository?: TargetSpreadsheetRepository;
  googleIdentityVerifier?: GoogleIdentityVerifierPort;
  adminSessionStore?: AdminSessionStore;
  systemSettingsRepository?: SystemSettingsRepository;
  encryptedSettingsService?: EncryptedSettingsService;
  emailNotificationRepository?: EmailNotificationRepository;
  emailNotificationDispatcher?: EmailNotificationDispatcher;
  emailProviderFactory?: (config: SmtpConfig) => EmailProvider;
  getMasterEmails?: () => Promise<string[]> | string[];
  serviceAccountEmail?: string;
  submissionRecoveryRepository?: SubmissionRecoveryRepository;
  telegramAlertRepository?: TelegramAlertRepository;
  getTelegramChatIds?: () => Promise<string[]> | string[];
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  if (dependencies.submissionRecoveryRepository && dependencies.repository && 'recoveryRepository' in dependencies.repository) {
    if (!(dependencies.repository as any).recoveryRepository) {
      (dependencies.repository as any).recoveryRepository = dependencies.submissionRecoveryRepository;
    }
  }

  app.use(express.json());
  app.use(cookieParser());

  if (dependencies.temporaryFileStorage) {
    app.use('/api/uploads', createUploadRoutes(dependencies.temporaryFileStorage, dependencies.catalog));
  }

  app.get('/api/health', async (_req, res) => {
    let dbStatus: 'up' | 'down' = 'up';
    if (dependencies.checkDatabase) {
      try {
        const isUp = await dependencies.checkDatabase();
        dbStatus = isUp ? 'up' : 'down';
      } catch {
        dbStatus = 'down';
      }
    }

    const payload = healthResponse({ database: dbStatus });
    const statusCode = payload.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(payload);
  });

  // Target routes and nested submission routes
  const settingsRepo = dependencies.systemSettingsRepository ?? new MemorySystemSettingsRepository();
  const encryptedSettingsService =
    dependencies.encryptedSettingsService ??
    new EncryptedSettingsService(settingsRepo, process.env.APP_SETTINGS_ENCRYPTION_KEY);

  const targetRoutes = createTargetRoutes(dependencies.catalog);
  const submissionRoutes = createSubmissionRoutes(
    dependencies.catalog,
    dependencies.repository,
    dependencies.temporaryFileStorage && dependencies.googleDriveRepository
      ? { storage: dependencies.temporaryFileStorage, drive: dependencies.googleDriveRepository }
      : undefined,
    dependencies.spreadsheetRepository && dependencies.targetSpreadsheetService
      ? {
          repository: dependencies.spreadsheetRepository,
          targetSpreadsheetService: dependencies.targetSpreadsheetService,
        }
      : undefined,
    dependencies.emailNotificationRepository
      ? {
          repository: dependencies.emailNotificationRepository,
          getMasterEmails: async () => {
            if (dependencies.getMasterEmails) {
              return dependencies.getMasterEmails();
            }
            try {
              const cfg = await loadEmailConfig(encryptedSettingsService);
              return cfg.masterEmails;
            } catch {
              return [];
            }
          },
        }
      : undefined,
    dependencies.submissionRecoveryRepository
      ? {
          repository: dependencies.submissionRecoveryRepository,
          telegramAlertRepository: dependencies.telegramAlertRepository,
          getTelegramChatIds: async () => {
            if (dependencies.getTelegramChatIds) {
              return dependencies.getTelegramChatIds();
            }
            if (encryptedSettingsService) {
              try {
                const cfg = await loadTelegramConfig(encryptedSettingsService);
                return cfg.enabled ? cfg.chatIds : [];
              } catch {
                return [];
              }
            }
            return [];
          },
        }
      : undefined,
  );

  targetRoutes.use('/:id/submissions', submissionRoutes);
  app.use('/api/targets', targetRoutes);

  // Admin session and routes
  const sessionStore = dependencies.adminSessionStore ?? new MemoryAdminSessionStore();
  if (dependencies.googleIdentityVerifier) {
    app.use('/api/admin/auth', createAdminAuthRoutes(dependencies.googleIdentityVerifier, sessionStore));
  }
  app.use('/api/admin', createAdminMeRoute(sessionStore));

  app.use('/api/admin/settings', createAdminSettingsRoutes(
    settingsRepo,
    sessionStore,
    dependencies.serviceAccountEmail,
    dependencies.googleDriveRepository?.inspectFolder
      ? { inspectFolder: dependencies.googleDriveRepository.inspectFolder.bind(dependencies.googleDriveRepository) }
      : undefined,
    dependencies.catalog,
    dependencies.targetSpreadsheetService,
    dependencies.targetSpreadsheetRepository,
    encryptedSettingsService,
    dependencies.emailNotificationRepository,
    dependencies.emailNotificationDispatcher,
    dependencies.emailProviderFactory,
    dependencies.submissionRecoveryRepository,
    dependencies.repository,
    dependencies.temporaryFileStorage,
    dependencies.googleDriveRepository,
    dependencies.spreadsheetRepository,
  ));

  // Central error handler
  app.use(errorHandler);

  return app;
}
