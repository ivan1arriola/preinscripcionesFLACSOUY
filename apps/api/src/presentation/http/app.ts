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
import type { FormProfileRepository } from '../../ports/form-profile-repository.js';
import { MemoryFormProfileRepository } from '../../infrastructure/fixtures/memory-form-profile-repository.js';

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
import { createAdminProfileRoutes } from './admin-profile-routes.js';
import type { SystemSettingsRepository } from '../../ports/system-settings-repository.js';
import { MemorySystemSettingsRepository } from '../../infrastructure/fixtures/memory-system-settings-repository.js';
import { createAdminSettingsRoutes } from './admin-settings-routes.js';
import type { TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';
import type { TargetSpreadsheetRepository } from '../../ports/target-spreadsheet-repository.js';

export interface AppDependencies {
  catalog: AcademicCatalog;
  repository: SubmissionRepository;
  checkDatabase?: () => Promise<boolean>;
  temporaryFileStorage?: TemporaryFileStoragePort;
  googleDriveRepository?: GoogleDriveRepositoryPort;
  spreadsheetRepository?: SpreadsheetRepository;
  targetSpreadsheetService?: TargetSpreadsheetService;
  targetSpreadsheetRepository?: TargetSpreadsheetRepository;
  formProfileRepository?: FormProfileRepository;
  googleIdentityVerifier?: GoogleIdentityVerifierPort;
  adminSessionStore?: AdminSessionStore;
  systemSettingsRepository?: SystemSettingsRepository;
  serviceAccountEmail?: string;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  if (dependencies.temporaryFileStorage) {
    app.use('/api/uploads', createUploadRoutes(dependencies.temporaryFileStorage));
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
  const profileRepo = dependencies.formProfileRepository ?? new MemoryFormProfileRepository();
  const targetRoutes = createTargetRoutes(dependencies.catalog, profileRepo);
  const submissionRoutes = createSubmissionRoutes(
    dependencies.catalog,
    dependencies.repository,
    profileRepo,
    dependencies.temporaryFileStorage && dependencies.googleDriveRepository
      ? { storage: dependencies.temporaryFileStorage, drive: dependencies.googleDriveRepository }
      : undefined,
    dependencies.spreadsheetRepository && dependencies.targetSpreadsheetService
      ? {
          repository: dependencies.spreadsheetRepository,
          targetSpreadsheetService: dependencies.targetSpreadsheetService,
        }
      : undefined,
  );

  targetRoutes.use('/:id/submissions', submissionRoutes);
  app.use('/api/targets', targetRoutes);

  // Admin session and routes
  const sessionStore = dependencies.adminSessionStore ?? new MemoryAdminSessionStore();
  if (dependencies.googleIdentityVerifier) {
    app.use('/api/admin/auth', createAdminAuthRoutes(profileRepo, dependencies.googleIdentityVerifier, sessionStore));
  }
  app.use('/api/admin', createAdminMeRoute(sessionStore));
  app.use('/api/admin/profiles', createAdminProfileRoutes(profileRepo, sessionStore));

  const settingsRepo = dependencies.systemSettingsRepository ?? new MemorySystemSettingsRepository();
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
  ));

  // Central error handler
  app.use(errorHandler);

  return app;
}
