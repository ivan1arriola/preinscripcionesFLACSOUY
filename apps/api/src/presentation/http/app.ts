import express, { type Express } from 'express';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import { healthResponse } from './health.js';
import { createTargetRoutes } from './target-routes.js';
import { createSubmissionRoutes } from './submission-routes.js';
import { createAdminRoutes } from './admin-routes.js';
import { AdminService } from '../../application/admin/admin-service.js';
import { AdminAuthService } from '../../infrastructure/auth/admin-auth.js';
import type { SystemErrorRepository } from '../../ports/system-error-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import type { DriveRepository } from '../../ports/drive-repository.js';
import { errorHandler } from './error-handler.js';

export interface AppDependencies {
  catalog: AcademicCatalog;
  repository: SubmissionRepository;
  checkDatabase?: () => Promise<boolean>;
  adminService?: AdminService;
  authService?: AdminAuthService;
  errorRepository?: SystemErrorRepository;
  spreadsheetRepository?: SpreadsheetRepository;
  driveRepository?: DriveRepository;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(express.json());

  // Health endpoint
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

  // Admin routes
  const authService = dependencies.authService || new AdminAuthService();
  const adminService =
    dependencies.adminService ||
    new AdminService({
      catalog: dependencies.catalog,
      checkDatabase: dependencies.checkDatabase,
      errorRepo: dependencies.errorRepository,
      spreadsheetRepo: dependencies.spreadsheetRepository,
      driveRepo: dependencies.driveRepository,
    });
  app.use('/api/admin', createAdminRoutes(adminService, authService));

  // Target routes and nested submission routes
  const targetRoutes = createTargetRoutes(dependencies.catalog);
  const submissionRoutes = createSubmissionRoutes(
    dependencies.catalog,
    dependencies.repository
  );

  targetRoutes.use('/:id/submissions', submissionRoutes);
  app.use('/api/targets', targetRoutes);

  // Central error handler
  app.use(errorHandler);

  return app;
}
