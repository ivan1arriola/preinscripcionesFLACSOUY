import { Router } from 'express';
import { z } from 'zod';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import type { FormProfileRepository } from '../../ports/form-profile-repository.js';
import { submitPreinscription } from '../../application/submit-preinscription.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import type { TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';

const submissionSchema = z.object({
  clientSubmissionId: z.string().optional(),
  configRevision: z.string({ required_error: 'La revisión de configuración es obligatoria.' }),
  values: z.record(z.string(), {
    required_error: 'Los valores del formulario son obligatorios.',
  }),
  files: z.array(z.object({
    token: z.string(), fieldKey: z.string(), originalName: z.string(), size: z.number(), mimeType: z.string(),
  })).optional(),
});

interface SubmissionFileDependencies {
  storage: TemporaryFileStoragePort;
  drive: GoogleDriveRepositoryPort;
}

interface SubmissionSpreadsheetDependencies {
  repository: SpreadsheetRepository;
  targetSpreadsheetService: TargetSpreadsheetService;
}

export function createSubmissionRoutes(
  catalog: AcademicCatalog,
  repository: SubmissionRepository,
  profileRepository: FormProfileRepository,
  fileDependencies?: SubmissionFileDependencies,
  spreadsheetDependencies?: SubmissionSpreadsheetDependencies,
): Router {
  const router = Router({ mergeParams: true });

  router.post('/', async (req, res, next) => {
    try {
      const params = req.params as Record<string, string | undefined>;
      const targetId = params.id ?? '';

      const parsed = submissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'El cuerpo de la solicitud no cumple con el formato esperado.',
            details: parsed.error.flatten(),
          },
        });
        return;
      }

      const result = await submitPreinscription(catalog, repository, profileRepository, {
        clientSubmissionId: parsed.data.clientSubmissionId,
        targetId,
        configRevision: parsed.data.configRevision,
        values: parsed.data.values,
        files: parsed.data.files,
      });

      if (!result.ok) {
        switch (result.code) {
          case 'NOT_FOUND':
            res.status(404).json({
              error: {
                code: 'NOT_FOUND',
                message: result.message,
              },
            });
            return;
          case 'CLOSED':
            res.status(409).json({
              error: {
                code: 'CLOSED',
                message: result.message,
              },
            });
            return;
          case 'STALE_REVISION':
            res.status(409).json({
              error: {
                code: 'STALE_REVISION',
                message: result.message,
                fieldErrors: result.fieldErrors,
              },
            });
            return;
          case 'INCOMPATIBLE_FORM':
            res.status(409).json({
              error: {
                code: 'INCOMPATIBLE_FORM',
                message: result.message,
                issues: result.issues,
              },
            });
            return;
          case 'VALIDATION_ERROR':
            res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: result.message,
                fieldErrors: result.fieldErrors,
              },
            });
            return;
        }
      }

      const files = parsed.data.files ?? [];
      let storedDriveFiles: Array<{ token: string; driveFileId?: string }> = [];
      if (files.length > 0) {
        if (!fileDependencies) {
          await repository.markProcessing(result.submissionId, 'failed', 'La carga de documentación no está disponible en este momento.');
          res.status(503).json({ error: { code: 'FILE_PROCESSING_UNAVAILABLE', message: 'La carga de documentación no está disponible en este momento.' } });
          return;
        }
        const sessionId = req.header('x-preinscription-session')?.trim();
        if (!sessionId) {
          await repository.markProcessing(result.submissionId, 'failed', 'La sesión de preinscripción es obligatoria para enviar archivos.');
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'La sesión de preinscripción es obligatoria para enviar archivos.' } });
          return;
        }
        try {
          const driveFiles = [];
          for (const file of files) {
            const temporary = await fileDependencies.storage.open(file.token, sessionId);
            driveFiles.push({ token: file.token, fieldKey: file.fieldKey, originalName: temporary.originalName, mimeType: temporary.mimeType, data: temporary.data });
          }
          const stored = await fileDependencies.drive.storeSubmissionFiles({
            submissionId: result.submissionId,
            files: driveFiles,
            target: result.driveTarget,
            values: parsed.data.values,
          });
          storedDriveFiles = stored.files;
          for (const file of stored.files) {
            if (file.driveFileId) {
              await repository.markFileStored(file.token, file.driveFileId);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo guardar la documentación.';
          for (const file of files) {
            await repository.markFileFailed(file.token, message);
          }
          await repository.markProcessing(result.submissionId, 'failed', message);
          res.status(502).json({ error: { code: 'FILE_PROCESSING_ERROR', message } });
          return;
        }
      }

      if (spreadsheetDependencies) {
        try {
          const target = await catalog.revalidateTarget(targetId);
          if (!target) {
            await repository.markProcessing(result.submissionId, 'failed', 'No se encontró el destino académico para crear su planilla.');
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No se encontró el destino académico para crear su planilla.' } });
            return;
          }
          const spreadsheet = await spreadsheetDependencies.targetSpreadsheetService.ensureForTarget(target);
          await spreadsheetDependencies.repository.appendByHeaders(
            spreadsheet.spreadsheetId,
            result.spreadsheet.valuesByColumnName,
            result.spreadsheet.requiredColumns,
            spreadsheet.sheetName,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo crear o guardar la planilla de la preinscripción.';
          await repository.markProcessing(result.submissionId, 'failed', message);
          res.status(502).json({ error: { code: 'SPREADSHEET_PROCESSING_ERROR', message } });
          return;
        }
      }

      await repository.markProcessing(result.submissionId, 'success');

      if (files.length > 0) {
        const sessionId = req.header('x-preinscription-session')?.trim();
        if (sessionId && fileDependencies) {
          for (const file of storedDriveFiles) {
            try {
              await fileDependencies.storage.remove(file.token, sessionId);
            } catch (cleanupError) {
              console.error('[Uploads] Error al limpiar archivo temporal:', cleanupError);
            }
          }
        }
      }

      res.status(201).json({ submissionId: result.submissionId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
