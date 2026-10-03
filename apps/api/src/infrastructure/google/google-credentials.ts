import fs from 'fs';
import path from 'path';
import { GoogleAuth, JWT } from 'google-auth-library';

export interface LoadedGoogleOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export interface GoogleCredentialsResult {
  serviceAccountPath?: string;
  clientEmail?: string;
  tokenProvider?: () => Promise<string>;
  oauthConfig: LoadedGoogleOAuthConfig;
}

// `drive.file` is limited to files created/opened by the app and can return
// 404 for a manually shared existing root folder. The app needs to inspect
// that configured folder and create children inside it.
export const GOOGLE_SERVICE_ACCOUNT_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

const CANDIDATE_DIRS = [
  path.resolve(process.cwd(), '.secrets'),
  path.resolve(process.cwd(), '..', '.secrets'),
  path.resolve(process.cwd(), '../..', '.secrets'),
  path.resolve('/app/.secrets'),
  path.resolve('/etc/secrets'),
];

export function findSecretFile(filename: string, explicitPath?: string): string | null {
  if (explicitPath !== undefined && explicitPath !== '') {
    return fs.existsSync(explicitPath) ? explicitPath : null;
  }

  for (const dir of CANDIDATE_DIRS) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function loadGoogleOAuthSecrets(explicitPath?: string): LoadedGoogleOAuthConfig {
  const result: LoadedGoogleOAuthConfig = {
    clientId: process.env.GOOGLE_OIDC_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OIDC_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_OIDC_REDIRECT_URI,
  };

  const file = findSecretFile('google-oauth-web-client.json', explicitPath || process.env.GOOGLE_OAUTH_CLIENT_PATH);
  if (!file) {
    return result;
  }

  try {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    const config = content.web || content.installed || content;

    if (!result.clientId && config.client_id) {
      result.clientId = config.client_id;
    }
    if (!result.clientSecret && config.client_secret) {
      result.clientSecret = config.client_secret;
    }
    if (!result.redirectUri && Array.isArray(config.redirect_uris) && config.redirect_uris.length > 0) {
      result.redirectUri = config.redirect_uris[0];
    }
  } catch (err) {
    console.warn(`[GoogleCredentials] No se pudo leer el archivo OAuth ${file}:`, err);
  }

  return result;
}

export function loadGoogleServiceAccountCredentials(explicitPath?: string): {
  serviceAccountPath?: string;
  clientEmail?: string;
  tokenProvider?: () => Promise<string>;
} {
  const file = findSecretFile(
    'google-service-account.json',
    explicitPath || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  );

  if (file) {
    let clientEmail: string | undefined;
    try {
      const saJson = JSON.parse(fs.readFileSync(file, 'utf8'));
      clientEmail = saJson.client_email;
    } catch {}

    const subject = process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT?.trim();
    let auth: GoogleAuth | JWT;
    if (subject) {
      const credentials = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        client_email?: string;
        private_key?: string;
        private_key_id?: string;
      };
      if (!credentials.client_email || !credentials.private_key) {
        throw new Error('La cuenta de servicio de Google no contiene client_email o private_key para delegación de dominio.');
      }
      auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        keyId: credentials.private_key_id,
        subject,
        scopes: [...GOOGLE_SERVICE_ACCOUNT_SCOPES],
      });
      console.info(`[GoogleCredentials] Delegación de dominio configurada para ${subject}.`);
    } else {
      auth = new GoogleAuth({
        keyFile: file,
        scopes: [...GOOGLE_SERVICE_ACCOUNT_SCOPES],
      });
    }

    return {
      serviceAccountPath: file,
      clientEmail,
      tokenProvider: async () => {
        const tokenRes = auth instanceof JWT
          ? await auth.getAccessToken()
          : await (await auth.getClient()).getAccessToken();
        if (!tokenRes.token) {
          throw new Error('No se pudo obtener el token de acceso para la cuenta de servicio de Google.');
        }
        return tokenRes.token;
      },
    };
  }

  if (process.env.GOOGLE_ACCESS_TOKEN) {
    const rawToken = process.env.GOOGLE_ACCESS_TOKEN;
    return {
      tokenProvider: async () => rawToken,
    };
  }

  return {};
}

export function loadAllGoogleCredentials(): GoogleCredentialsResult {
  const sa = loadGoogleServiceAccountCredentials();
  const oauthConfig = loadGoogleOAuthSecrets();

  return {
    serviceAccountPath: sa.serviceAccountPath,
    clientEmail: sa.clientEmail,
    tokenProvider: sa.tokenProvider,
    oauthConfig,
  };
}
