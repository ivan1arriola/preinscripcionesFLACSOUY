import { Router } from 'express';
import { z } from 'zod';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import type { FormProfileRepository } from '../../ports/form-profile-repository.js';
import { submitPreinscription } from '../../application/submit-preinscription.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';

const submissionSchema = z.object({
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

export function createSubmissionRoutes(
  catalog: AcademicCatalog,
  repository: SubmissionRepository,
  profileRepository: FormProfileRepository,
  fileDependencies?: SubmissionFileDependencies
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
      if (files.length > 0) {
        if (!fileDependencies) {
          res.status(503).json({ error: { code: 'FILE_PROCESSING_UNAVAILABLE', message: 'La carga de documentación no está disponible en este momento.' } });
          return;
        }
        const sessionId = req.header('x-preinscription-session')?.trim();
        if (!sessionId) {
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
            target: result.driveTarget,
            values: parsed.data.values,
            files: driveFiles 
          });
          for (const file of stored) {
            await fileDependencies.storage.remove(file.token, sessionId);
          }
        } catch (error) {
          res.status(502).json({ error: { code: 'FILE_PROCESSING_ERROR', message: error instanceof Error ? error.message : 'No se pudo guardar la documentación.' } });
          return;
        }
      }

      res.status(201).json({ submissionId: result.submissionId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
