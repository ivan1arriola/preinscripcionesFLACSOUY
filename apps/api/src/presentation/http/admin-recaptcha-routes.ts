import { z } from 'zod';
import { createAsyncRouter } from './async-router.js';
import {
  createRequireAdminSession,
  type AdminSessionStore,
  type RequestWithAdminSession,
} from '../../application/admin-session.js';
import type { EncryptedSettingsService } from '../../infrastructure/security/encrypted-settings.js';
import {
  loadRecaptchaConfig,
  maskRecaptchaConfig,
  saveRecaptchaConfig,
} from '../../infrastructure/recaptcha/recaptcha.js';

const UpdateRecaptchaSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  siteKey: z.string().max(200).optional(),
  secretKey: z.string().max(200).optional(),
  minScore: z.number().min(0.1).max(0.9).optional(),
});

/** Configuración de reCAPTCHA v3 en el panel administrativo (GET y PUT, con sesión y CSRF). */
export function createAdminRecaptchaRoutes(
  sessionStore: AdminSessionStore,
  settings: EncryptedSettingsService,
) {
  const router = createAsyncRouter();
  router.use(createRequireAdminSession(sessionStore));

  router.get('/', async (_req, res) => {
    res.json({ recaptcha: maskRecaptchaConfig(await loadRecaptchaConfig(settings)) });
  });

  router.put('/', async (req: RequestWithAdminSession, res) => {
    const parsed = UpdateRecaptchaSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Datos de configuración de reCAPTCHA inválidos.', issues: parsed.error.issues },
      });
      return;
    }
    try {
      await saveRecaptchaConfig(settings, parsed.data, req.adminUser?.email || 'admin');
    } catch (error) {
      res.status(400).json({
        error: {
          code: 'INVALID_RECAPTCHA_CONFIG',
          message: error instanceof Error ? error.message : 'No se pudo guardar la configuración de reCAPTCHA.',
        },
      });
      return;
    }
    res.json({
      ok: true,
      message: 'Configuración de reCAPTCHA guardada correctamente.',
      recaptcha: maskRecaptchaConfig(await loadRecaptchaConfig(settings)),
    });
  });

  return router;
}
