import type { RequestHandler } from 'express';
import {
  RECAPTCHA_ACTION,
  isRecaptchaActive,
  type RecaptchaConfig,
  type RecaptchaVerifier,
} from '../../infrastructure/recaptcha/recaptcha.js';

export const RECAPTCHA_TOKEN_HEADER = 'x-recaptcha-token';

export interface RecaptchaGuardOptions {
  getConfig: () => Promise<RecaptchaConfig>;
  verify: RecaptchaVerifier;
}

/**
 * Exige un token de reCAPTCHA v3 válido en el envío público. Si reCAPTCHA no está activado en el panel
 * administrativo, o si Google no responde, deja pasar la petición: se prefiere no cerrar la convocatoria
 * por una configuración pendiente o una caída ajena (el límite de frecuencia sigue protegiendo).
 */
export function createRecaptchaGuard(options: RecaptchaGuardOptions): RequestHandler {
  return async (req, res, next) => {
    let config: RecaptchaConfig;
    try {
      config = await options.getConfig();
    } catch (error) {
      console.warn('[reCAPTCHA] Configuración no disponible; se omite la verificación:', error instanceof Error ? error.message : error);
      next();
      return;
    }

    if (!isRecaptchaActive(config)) {
      next();
      return;
    }

    const verification = await options.verify({
      secretKey: config.secretKey,
      token: req.header(RECAPTCHA_TOKEN_HEADER),
      remoteIp: req.ip,
      minScore: config.minScore,
      expectedAction: RECAPTCHA_ACTION,
    });

    if (verification.status === 'unavailable') {
      console.warn('[reCAPTCHA] Google no respondió; se acepta el envío sin verificar.');
      next();
      return;
    }

    if (verification.status === 'failed') {
      res.status(403).json({
        error: {
          code: 'CAPTCHA_FAILED',
          message: 'No pudimos verificar que la solicitud la envía una persona. Recargá la página e intentá de nuevo.',
        },
      });
      return;
    }

    next();
  };
}
