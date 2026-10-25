import type { ResolvedEmailConfig } from './email-config.js';
import { FakeEmailProvider, type EmailProvider } from './email-provider.js';
import { MauticEmailProvider } from './mautic-email-provider.js';
import { SmtpEmailProvider } from './smtp-email-provider.js';
import { createMauticClientCache } from '../mautic/mautic-config.js';

/**
 * Elige el proveedor de envío según la configuración. Conserva un cliente de
 * Mautic por juego de credenciales para reutilizar el token OAuth2 entre lotes.
 */
export function createEmailProviderResolver(): (config: ResolvedEmailConfig) => EmailProvider | null {
  const mauticClientFor = createMauticClientCache();

  return (config) => {
    if (!config.enabled) return null;
    switch (config.provider) {
      case 'fake':
        return new FakeEmailProvider();
      case 'smtp':
        return config.smtp ? new SmtpEmailProvider(config.smtp) : null;
      case 'mautic': {
        const mautic = config.mautic;
        if (!mautic?.applicantTemplateId || !mautic.teamTemplateId) return null;
        return new MauticEmailProvider(mauticClientFor(mautic), {
          applicantTemplateId: mautic.applicantTemplateId,
          teamTemplateId: mautic.teamTemplateId,
        });
      }
      default:
        return null;
    }
  };
}
