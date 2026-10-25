import type { ResolvedEmailConfig } from './email-config.js';
import { FakeEmailProvider, type EmailProvider } from './email-provider.js';
import { MauticEmailProvider } from './mautic-email-provider.js';
import { SmtpEmailProvider } from './smtp-email-provider.js';
import { MauticClient } from '../mautic/mautic-client.js';
import { mauticCredentials, type MauticConfig } from '../mautic/mautic-config.js';

/**
 * Elige el proveedor de envío según la configuración. Conserva un cliente de
 * Mautic por juego de credenciales para reutilizar el token OAuth2 entre lotes.
 */
export function createEmailProviderResolver(): (config: ResolvedEmailConfig) => EmailProvider | null {
  let cachedMauticClient: { key: string; client: MauticClient } | null = null;
  const mauticClientFor = (config: MauticConfig): MauticClient => {
    const key = `${config.baseUrl}|${config.clientId}|${config.clientSecret}`;
    if (cachedMauticClient?.key !== key) {
      cachedMauticClient = { key, client: new MauticClient(mauticCredentials(config)) };
    }
    return cachedMauticClient.client;
  };

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
