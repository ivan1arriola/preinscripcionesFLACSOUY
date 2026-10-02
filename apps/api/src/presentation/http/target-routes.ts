import { Router } from 'express';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import { discoverTargets } from '../../application/discover-targets.js';
import { getTargetForm } from '../../application/get-target-form.js';

export function createTargetRoutes(catalog: AcademicCatalog): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const targets = await discoverTargets(catalog);
      res.json({ targets });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await getTargetForm(catalog, req.params.id);

      if (!result.ok) {
        if (result.code === 'NOT_FOUND') {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: result.message,
            },
          });
          return;
        }

        res.status(409).json({
          error: {
            code: result.code,
            message: result.message,
            issues: result.issues ?? [],
          },
        });
        return;
      }

      res.json(result.form);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
