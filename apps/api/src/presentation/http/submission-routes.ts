import { Router } from 'express';
import { z } from 'zod';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import { submitPreinscription } from '../../application/submit-preinscription.js';

const submissionSchema = z.object({
  configRevision: z.string({ required_error: 'La revisión de configuración es obligatoria.' }),
  values: z.record(z.string(), {
    required_error: 'Los valores del formulario son obligatorios.',
  }),
});

export function createSubmissionRoutes(
  catalog: AcademicCatalog,
  repository: SubmissionRepository
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

      const result = await submitPreinscription(catalog, repository, {
        targetId,
        configRevision: parsed.data.configRevision,
        values: parsed.data.values,
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

      res.status(201).json({ submissionId: result.submissionId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
