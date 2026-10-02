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

  // Create a new version for a profile
  router.post('/:type/versions', async (req: RequestWithAdminSession, res) => {
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

    const rawDefinition = req.body?.definition;
    if (!rawDefinition) {
      res.status(422).json({
        error: {
          code: 'INVALID_DEFINITION',
          message: 'Falta la definición del perfil en el cuerpo de la solicitud.',
        },
      });
      return;
    }

    let validatedDefinition;
    try {
      validatedDefinition = validateProfileDefinition(typeParam, rawDefinition);
    } catch (validationError) {
      res.status(422).json({
        error: {
          code: 'INVALID_DEFINITION',
          message: validationError instanceof Error ? validationError.message : 'Definición de perfil inválida.',
        },
      });
      return;
    }

    try {
      const version = await profileRepository.createVersion(
        {
          type: typeParam,
          definition: validatedDefinition,
        },
        req.adminUser?.email ?? 'web@flacso.edu.uy'
      );

      res.status(201).json({ version });
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Error al crear versión de perfil',
        },
      });
    }
  });

  // Activate a version
  router.post('/:type/activate/:versionId', async (req: RequestWithAdminSession, res) => {
    const typeParam = String(req.params.type ?? '');
    const versionId = String(req.params.versionId ?? '');

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

      await profileRepository.activateVersion(
        profile.id,
        versionId,
        req.adminUser?.email ?? 'web@flacso.edu.uy'
      );
      res.json({ ok: true, profileId: profile.id, activeVersionId: versionId });
    } catch (error) {
      res.status(400).json({
        error: {
          code: 'ACTIVATION_FAILED',
          message: error instanceof Error ? error.message : 'Error al activar versión de perfil',
        },
      });
    }
  });

  return router;
}
