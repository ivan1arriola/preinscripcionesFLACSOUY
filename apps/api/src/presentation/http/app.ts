import type { SheetsAttemptDependencies } from '../../application/write-sheets-row.js';
import type { MauticClient } from '../../infrastructure/mautic/mautic-client.js';
import { shouldQueueEnrollmentNotice, loadMauticConfig, type MauticConfig } from '../../infrastructure/mautic/mautic-config.js';
import express, { type Express } from 'express';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import type { SubmissionRepository } from '../../ports/submission-repository.js';
import { healthResponse, type CatalogHealthResponse } from './health.js';
import { createTargetRoutes } from './target-routes.js';
import { createSubmissionRoutes, type LeaseOptions } from './submission-routes.js';
import { createMetaCapiTrackerFromEnv, type MetaCapiTracker } from '../../infrastructure/meta/meta-capi.js';
import { errorHandler } from './error-handler.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import { createUploadRoutes } from './upload-routes.js';
import type { GoogleDriveRepositoryPort } from '../../ports/google-drive-repository.js';
import type { SpreadsheetRepository } from '../../ports/spreadsheet-repository.js';
import type { SubmissionRecoveryRepository } from '../../ports/submission-recovery-repository.js';

import cookieParser from 'cookie-parser';
import type { GoogleIdentityVerifierPort } from '../../infrastructure/auth/google-oidc.js';
import {
  MemoryAdminSessionStore,
  type AdminSessionStore,
} from '../../application/admin-session.js';
import {
  createAdminAuthRoutes,
  createAdminMeRoute,
} from './admin-auth-routes.js';
import type { SystemSettingsRepository } from '../../ports/system-settings-repository.js';
import { MemorySystemSettingsRepository } from '../../infrastructure/fixtures/memory-system-settings-repository.js';
import { createAdminSettingsRoutes } from './admin-settings-routes.js';
import type { TargetSpreadsheetService } from '../../application/target-spreadsheet-service.js';
import type { TargetSpreadsheetRepository } from '../../ports/target-spreadsheet-repository.js';
import { EncryptedSettingsService } from '../../infrastructure/security/encrypted-settings.js';
import type { EmailNotificationRepository } from '../../ports/email-notification-repository.js';
import type { EmailNotificationDispatcher } from '../../application/email-notification-dispatcher.js';
import { loadEmailConfig, type SmtpConfig } from '../../infrastructure/email/email-config.js';
import type { EmailProvider } from '../../infrastructure/email/email-provider.js';
import type { TelegramAlertRepository } from '../../ports/telegram-alert-repository.js';
import type { TelegramProvider } from '../../ports/telegram-provider.js';
import { loadTelegramConfig } from '../../infrastructure/telegram/telegram-config.js';
import {
  RECAPTCHA_ACTION,
  isRecaptchaActive,
  loadRecaptchaConfig,
  verifyRecaptchaToken,
  type RecaptchaVerifier,
} from '../../infrastructure/recaptcha/recaptcha.js';
import { createRecaptchaGuard } from './recaptcha-guard.js';
import { createAdminRecaptchaRoutes } from './admin-recaptcha-routes.js';
import { createIpRateLimit, type RateLimitOptions } from './rate-limit.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export interface RateLimitSettings {
  submissions: RateLimitOptions;
  uploads: RateLimitOptions;
  adminAuth: RateLimitOptions;
  /** Envíos por correo del postulante: evita usar el formulario para escribirle a un tercero. */
  submissionsPerEmail: RateLimitOptions;
}

const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  submissions: { windowMs: FIFTEEN_MINUTES_MS, max: 30 },
  uploads: { windowMs: FIFTEEN_MINUTES_MS, max: 120 },
  adminAuth: { windowMs: FIFTEEN_MINUTES_MS, max: 30 },
  submissionsPerEmail: { windowMs: 60 * 60 * 1000, max: 5 },
};

/**
 * Cantidad de proxies de confianza delante de la API. En producción son dos (Apache del servidor → nginx del
 * contenedor web); sin esto `req.ip` sería siempre el del proxy y el límite por IP bloquearía a todos a la vez.
 */
export function resolveTrustProxyHops(): number {
  const configured = Number(process.env.TRUST_PROXY_HOPS);
  if (process.env.TRUST_PROXY_HOPS !== undefined && Number.isInteger(configured) && configured >= 0) {
    return configured;
  }
  return process.env.NODE_ENV === 'production' ? 2 : 0;
}

export interface AppDependencies {
  catalog: AcademicCatalog;
  repository: SubmissionRepository;
  checkDatabase?: () => Promise<boolean>;
  /** Consulta el catálogo de WordPress; sin él (catálogo de fixtures) no hay nada que verificar. */
  checkCatalog?: () => Promise<CatalogHealthResponse>;
  temporaryFileStorage?: TemporaryFileStoragePort;
  googleDriveRepository?: GoogleDriveRepositoryPort;
  spreadsheetRepository?: SpreadsheetRepository;
  /** Intentos durables de Sheets (P3). */
  sheetsAttempts?: SheetsAttemptDependencies;
  targetSpreadsheetService?: TargetSpreadsheetService;
  targetSpreadsheetRepository?: TargetSpreadsheetRepository;
  googleIdentityVerifier?: GoogleIdentityVerifierPort;
  adminSessionStore?: AdminSessionStore;
  systemSettingsRepository?: SystemSettingsRepository;
  encryptedSettingsService?: EncryptedSettingsService;
  emailNotificationRepository?: EmailNotificationRepository;
  emailNotificationDispatcher?: EmailNotificationDispatcher;
  emailProviderFactory?: (config: SmtpConfig) => EmailProvider;
  getMasterEmails?: () => Promise<string[]> | string[];
  serviceAccountEmail?: string;
  submissionRecoveryRepository?: SubmissionRecoveryRepository;
  /** Mantiene vivo el lease de cada envío mientras se procesa (P4). */
  submissionLease?: LeaseOptions;
  /** Conversions API de Meta (SubmitApplication). Por defecto se arma con META_PIXEL_ID y META_CAPI_ACCESS_TOKEN. */
  metaTracker?: MetaCapiTracker;
  telegramAlertRepository?: TelegramAlertRepository;
  getTelegramChatIds?: () => Promise<string[]> | string[];
  getTelegramPreinscriptionChatIds?: () => Promise<string[]> | string[];
  telegramProviderFactory?: (botToken: string) => TelegramProvider;
  mauticClientFactory?: (config: MauticConfig) => Pick<MauticClient, 'verify'>;
  /** Proxies de confianza (por defecto 2 en producción, 0 en desarrollo y tests). */
  trustProxyHops?: number;
  /** `false` desactiva los límites de frecuencia; un objeto parcial reemplaza los valores por defecto. */
  rateLimits?: false | Partial<RateLimitSettings>;
  /** Verificador de reCAPTCHA (se inyecta en los tests; en producción consulta a Google). */
  recaptchaVerifier?: RecaptchaVerifier;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.set('trust proxy', dependencies.trustProxyHops ?? resolveTrustProxyHops());

  const rateLimits: RateLimitSettings | false = dependencies.rateLimits === false
    ? false
    : { ...DEFAULT_RATE_LIMITS, ...dependencies.rateLimits };

  if (dependencies.submissionRecoveryRepository && dependencies.repository && 'recoveryRepository' in dependencies.repository) {
    if (!(dependencies.repository as any).recoveryRepository) {
      (dependencies.repository as any).recoveryRepository = dependencies.submissionRecoveryRepository;
    }
  }

  app.use(express.json());
  app.use(cookieParser());

  if (rateLimits) {
    app.post('/api/uploads', createIpRateLimit(rateLimits.uploads));
  }

  if (dependencies.temporaryFileStorage) {
    app.use('/api/uploads', createUploadRoutes(dependencies.temporaryFileStorage, dependencies.catalog));
  }

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

  // Siempre responde 200: el estado va en el cuerpo, para que la guardia de despliegue lo lea con wget.
  app.get('/api/health/catalog', async (_req, res) => {
    const payload: CatalogHealthResponse = dependencies.checkCatalog
      ? await dependencies.checkCatalog()
      : { status: 'ok', code: 'not_configured', rejectedTargets: 0 };
    res.setHeader('Cache-Control', 'no-store');
    res.json(payload);
  });

  // Target routes and nested submission routes
  const settingsRepo = dependencies.systemSettingsRepository ?? new MemorySystemSettingsRepository();
  const encryptedSettingsService =
    dependencies.encryptedSettingsService ??
    new EncryptedSettingsService(settingsRepo, process.env.APP_SETTINGS_ENCRYPTION_KEY);

  const metaTracker = dependencies.metaTracker ?? createMetaCapiTrackerFromEnv();

  // Configuración pública que necesita el navegador: sólo la clave del sitio de reCAPTCHA (no es secreta).
  app.get('/api/config', async (_req, res) => {
    let recaptcha: { enabled: boolean; siteKey?: string; action?: string } = { enabled: false };
    try {
      const config = await loadRecaptchaConfig(encryptedSettingsService);
      if (isRecaptchaActive(config)) {
        recaptcha = { enabled: true, siteKey: config.siteKey, action: RECAPTCHA_ACTION };
      }
    } catch {
      // Sin configuración legible el formulario sigue funcionando sin reCAPTCHA.
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ recaptcha, meta: metaTracker ? { pixelId: metaTracker.pixelId } : { pixelId: null } });
  });

  // Antes de las rutas de destinos: primero el límite de frecuencia, después el reCAPTCHA.
  if (rateLimits) {
    app.post('/api/targets/:id/submissions', createIpRateLimit(rateLimits.submissions));
  }
  app.post(
    '/api/targets/:id/submissions',
    createRecaptchaGuard({
      getConfig: () => loadRecaptchaConfig(encryptedSettingsService),
      verify: dependencies.recaptchaVerifier ?? verifyRecaptchaToken,
    }),
  );

  const targetRoutes = createTargetRoutes(dependencies.catalog);
  const submissionRoutes = createSubmissionRoutes(
    dependencies.catalog,
    dependencies.repository,
    dependencies.temporaryFileStorage && dependencies.googleDriveRepository
      ? { storage: dependencies.temporaryFileStorage, drive: dependencies.googleDriveRepository }
      : undefined,
    dependencies.spreadsheetRepository && dependencies.targetSpreadsheetService
      ? {
          repository: dependencies.spreadsheetRepository,
          targetSpreadsheetService: dependencies.targetSpreadsheetService,
          attempts: dependencies.sheetsAttempts,
        }
      : undefined,
    dependencies.emailNotificationRepository
      ? {
          repository: dependencies.emailNotificationRepository,
          getMasterEmails: async () => {
            if (dependencies.getMasterEmails) {
              return dependencies.getMasterEmails();
            }
            try {
              const cfg = await loadEmailConfig(encryptedSettingsService);
              return cfg.masterEmails;
            } catch {
              return [];
            }
          },
        }
      : undefined,
    dependencies.submissionRecoveryRepository
      ? {
          repository: dependencies.submissionRecoveryRepository,
          telegramAlertRepository: dependencies.telegramAlertRepository,
          getTelegramChatIds: async () => {
            if (dependencies.getTelegramChatIds) {
              return dependencies.getTelegramChatIds();
            }
            if (encryptedSettingsService) {
              try {
                const cfg = await loadTelegramConfig(encryptedSettingsService);
                return cfg.enabled ? cfg.chatIds : [];
              } catch {
                return [];
              }
            }
            return [];
          },
          getTelegramPreinscriptionChatIds: async () => {
            if (dependencies.getTelegramPreinscriptionChatIds) {
              return dependencies.getTelegramPreinscriptionChatIds();
            }
            if (encryptedSettingsService) {
              try {
                const cfg = await loadTelegramConfig(encryptedSettingsService);
                return cfg.preinscriptionEnabled ? cfg.chatIds : [];
              } catch {
                return [];
              }
            }
            return [];
          },
        }
      : undefined,
    dependencies.telegramAlertRepository
      ? {
          repository: dependencies.telegramAlertRepository,
          getPreinscriptionChatIds: async () => {
            if (dependencies.getTelegramPreinscriptionChatIds) {
              return dependencies.getTelegramPreinscriptionChatIds();
            }
            if (encryptedSettingsService) {
              try {
                const cfg = await loadTelegramConfig(encryptedSettingsService);
                return cfg.preinscriptionEnabled ? cfg.chatIds : [];
              } catch {
                return [];
              }
            }
            return [];
          },
          getRecoveryChatIds: async () => {
            if (dependencies.getTelegramChatIds) {
              return dependencies.getTelegramChatIds();
            }
            if (encryptedSettingsService) {
              try {
                const cfg = await loadTelegramConfig(encryptedSettingsService);
                return cfg.enabled ? cfg.chatIds : [];
              } catch {
                return [];
              }
            }
            return [];
          },
        }
      : undefined,
    encryptedSettingsService
      ? {
          isContactSyncEnabled: async () => (await loadMauticConfig(encryptedSettingsService)).contactsEnabled,
          isEnrollmentNotifyEnabled: async () => shouldQueueEnrollmentNotice(await loadMauticConfig(encryptedSettingsService)),
        }
      : undefined,
    rateLimits ? { perEmail: rateLimits.submissionsPerEmail } : undefined,
    dependencies.submissionLease,
    metaTracker,
  );

  targetRoutes.use('/:id/submissions', submissionRoutes);
  app.use('/api/targets', targetRoutes);

  // Admin session and routes
  const sessionStore = dependencies.adminSessionStore ?? new MemoryAdminSessionStore();
  if (dependencies.googleIdentityVerifier) {
    if (rateLimits) {
      app.use('/api/admin/auth', createIpRateLimit(rateLimits.adminAuth));
    }
    app.use('/api/admin/auth', createAdminAuthRoutes(dependencies.googleIdentityVerifier, sessionStore));
  }
  app.use('/api/admin', createAdminMeRoute(sessionStore));

  // Debe montarse antes de /api/admin/settings, cuyo router exige sesión para todo su subárbol.
  app.use('/api/admin/settings/recaptcha', createAdminRecaptchaRoutes(sessionStore, encryptedSettingsService));

  app.use('/api/admin/settings', createAdminSettingsRoutes(
    settingsRepo,
    sessionStore,
    dependencies.serviceAccountEmail,
    dependencies.googleDriveRepository?.inspectFolder
      ? { inspectFolder: dependencies.googleDriveRepository.inspectFolder.bind(dependencies.googleDriveRepository) }
      : undefined,
    dependencies.catalog,
    dependencies.targetSpreadsheetService,
    dependencies.targetSpreadsheetRepository,
    encryptedSettingsService,
    dependencies.emailNotificationRepository,
    dependencies.emailNotificationDispatcher,
    dependencies.emailProviderFactory,
    dependencies.submissionRecoveryRepository,
    dependencies.repository,
    dependencies.temporaryFileStorage,
    dependencies.googleDriveRepository,
    dependencies.spreadsheetRepository,
    dependencies.telegramProviderFactory,
    dependencies.telegramAlertRepository,
    dependencies.mauticClientFactory,
    dependencies.sheetsAttempts,
  ));

  // Central error handler
  app.use(errorHandler);

  return app;
}
