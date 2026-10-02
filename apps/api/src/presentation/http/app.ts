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
import type { FormProfileRepository } from '../../ports/form-profile-repository.js';

export interface AppDependencies {
  catalog: AcademicCatalog;
  repository: SubmissionRepository;
  checkDatabase?: () => Promise<boolean>;
  temporaryFileStorage?: TemporaryFileStoragePort;
  googleDriveRepository?: GoogleDriveRepositoryPort;
  formProfileRepository?: FormProfileRepository;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(express.json());

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
  const targetRoutes = createTargetRoutes(dependencies.catalog);
  const submissionRoutes = createSubmissionRoutes(
    dependencies.catalog,
    dependencies.repository,
    dependencies.temporaryFileStorage && dependencies.googleDriveRepository
      ? { storage: dependencies.temporaryFileStorage, drive: dependencies.googleDriveRepository }
      : undefined
  );

  targetRoutes.use('/:id/submissions', submissionRoutes);
  app.use('/api/targets', targetRoutes);

  // Central error handler
  app.use(errorHandler);

  return app;
}
