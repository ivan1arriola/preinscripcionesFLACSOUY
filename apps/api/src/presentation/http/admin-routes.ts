import { Router, type Request, type Response } from 'express';
import type { AdminService } from '../../application/admin/admin-service.js';
import type { AdminAuthService } from '../../infrastructure/auth/admin-auth.js';
import type { ErrorOrigin, ErrorSeverity, ErrorStatus } from '../../domain/system-error.js';

export function createAdminRoutes(
  adminService: AdminService,
  authService: AdminAuthService
): Router {
  const router = Router();
  const requireAuth = authService.createAuthMiddleware();

  // 1. Auth routes (public login)
  router.post('/login', (req: Request, res: Response): void => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Usuario y contraseña requeridos',
      });
      return;
    }

    const isValid = authService.verifyCredentials(String(username), String(password));
    if (!isValid) {
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Credenciales inválidas',
      });
      return;
    }

    const session = authService.createSession(String(username));

    // Also set cookie if desired
    res.cookie('admin_token', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 3600 * 1000,
    });

    res.json({
      token: session.token,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      user: { username },
    });
  });

  router.post('/logout', (_req: Request, res: Response): void => {
    res.clearCookie('admin_token');
    res.json({ message: 'Sesión finalizada exitosamente' });
  });

  router.get('/me', requireAuth, (req: Request, res: Response): void => {
    res.json({
      authenticated: true,
      user: (req as any).admin,
    });
  });

  // 2. Targets and diagnostics
  router.get('/targets', requireAuth, async (_req: Request, res: Response): Promise<void> => {
    try {
      const targets = await adminService.listTargets();
      res.json(targets);
    } catch (err) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Error al listar targets',
      });
    }
  });

  router.get('/targets/:id/diagnostics', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const diagnostic = await adminService.diagnoseTarget(String(req.params.id));
      res.json(diagnostic);
    } catch (err) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Error al diagnosticar target',
      });
    }
  });

  // 3. System errors
  router.get('/errors', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, origin, severity, targetId, limit } = req.query;
      const errors = await adminService.listErrors({
        status: status as ErrorStatus,
        origin: origin as ErrorOrigin,
        severity: severity as ErrorSeverity,
        targetId: targetId ? String(targetId) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json(errors);
    } catch (err) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Error al listar errores del sistema',
      });
    }
  });

  router.post('/errors/:id/resolve', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const adminUser = (req as any).admin?.username || 'admin';
      const resolved = await adminService.resolveError(String(req.params.id), adminUser);

      if (!resolved) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Error '${req.params.id}' no encontrado`,
        });
        return;
      }

      res.json(resolved);
    } catch (err) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Error al resolver error del sistema',
      });
    }
  });

  // 4. Integrations health
  router.get('/health/integrations', requireAuth, async (_req: Request, res: Response): Promise<void> => {
    try {
      const health = await adminService.checkIntegrationsHealth();
      res.json(health);
    } catch (err) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Error al verificar salud de integraciones',
      });
    }
  });

  return router;
}
