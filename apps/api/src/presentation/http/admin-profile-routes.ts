import { Router } from 'express';
import type { FormProfileRepository } from '../../ports/form-profile-repository.js';
import {
  isSupportedOfferType,
  validateProfileDefinition,
} from '../../domain/form-profiles.js';
import {
  createRequireAdminSession,
  type AdminSessionStore,
  type RequestWithAdminSession,
} from '../../application/admin-session.js';

export function createAdminProfileRoutes(
  profileRepository: FormProfileRepository,
  sessionStore: AdminSessionStore
): Router {
  const router = Router();
  const requireAdmin = createRequireAdminSession(sessionStore);

  router.use(requireAdmin);

  // List all profiles
  router.get('/', async (_req, res) => {
    try {
      const profiles = await profileRepository.listProfiles();
      res.json({ profiles });
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Error al listar perfiles',
        },
      });
    }
  });

  // Get profile by offer type with active version and version history
  router.get('/:type', async (req, res) => {
    const typeParam = String(req.params.type ?? '');
    if (!isSupportedOfferType(typeParam)) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Tipo de oferta no compatible: ${typeParam}`,
        },
      });
      return;
    }

    try {
      const profile = await profileRepository.getByType(typeParam);
      if (!profile) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: `Perfil no encontrado para tipo: ${typeParam}`,
          },
        });
        return;
      }

      const activeEffective = await profileRepository.getActive(typeParam);
      const versions = await profileRepository.listVersions(profile.id);

      res.json({
        profile,
        activeVersion: activeEffective
          ? {
              id: activeEffective.versionId,
              versionNumber: activeEffective.versionNumber,
              definition: activeEffective.definition,
            }
          : null,
        versions,
      });
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Error al obtener perfil',
        },
      });
    }
  });

  // Create a new version for a profile (disabled in canonical forms)
  router.post('/:type/versions', async (_req: RequestWithAdminSession, res) => {
    res.status(410).json({
      error: {
        code: 'PROFILES_DISABLED',
        message: 'La edición de perfiles de formulario ya no está disponible. Los formularios se gestionan de forma canónica en código (canonical-v1).',
      },
    });
  });

  // Activate a version (disabled in canonical forms)
  router.post('/:type/activate/:versionId', async (_req: RequestWithAdminSession, res) => {
    res.status(410).json({
      error: {
        code: 'PROFILES_DISABLED',
        message: 'La edición de perfiles de formulario ya no está disponible. Los formularios se gestionan de forma canónica en código (canonical-v1).',
      },
    });
  });

  return router;
}

