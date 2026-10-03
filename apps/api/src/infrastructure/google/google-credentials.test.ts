import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  GOOGLE_SERVICE_ACCOUNT_SCOPES,
  findSecretFile,
  loadGoogleOAuthSecrets,
  loadGoogleServiceAccountCredentials,
  loadAllGoogleCredentials,
} from './google-credentials.js';

describe('Google Credentials Loader', () => {
  let tmpDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flacso-secrets-test-'));
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it('requests Drive scope that can inspect and write to an existing shared root folder', () => {
    expect(GOOGLE_SERVICE_ACCOUNT_SCOPES).toContain('https://www.googleapis.com/auth/drive');
    expect(GOOGLE_SERVICE_ACCOUNT_SCOPES).not.toContain('https://www.googleapis.com/auth/drive.file');
  });

  it('returns null when secret file does not exist', () => {
    const found = findSecretFile('non-existent-secret.json');
    expect(found).toBeNull();
  });

  it('finds secret file at explicit path', () => {
    const testFile = path.join(tmpDir, 'custom.json');
    fs.writeFileSync(testFile, JSON.stringify({ ok: true }));

    const found = findSecretFile('custom.json', testFile);
    expect(found).toBe(testFile);
  });

  it('loads OAuth config from web client JSON', () => {
    const oauthFile = path.join(tmpDir, 'google-oauth-web-client.json');
    fs.writeFileSync(
      oauthFile,
      JSON.stringify({
        web: {
          client_id: 'test-client-id.apps.googleusercontent.com',
          client_secret: 'test-secret',
          redirect_uris: ['http://localhost:5173/admin/perfiles'],
        },
      })
    );

    const config = loadGoogleOAuthSecrets(oauthFile);
    expect(config.clientId).toBe('test-client-id.apps.googleusercontent.com');
    expect(config.clientSecret).toBe('test-secret');
    expect(config.redirectUri).toBe('http://localhost:5173/admin/perfiles');
  });

  it('environment variables take precedence over OAuth JSON file', () => {
    const oauthFile = path.join(tmpDir, 'google-oauth-web-client.json');
    fs.writeFileSync(
      oauthFile,
      JSON.stringify({
        web: {
          client_id: 'file-client-id',
          client_secret: 'file-secret',
          redirect_uris: ['http://file-redirect'],
        },
      })
    );

    process.env.GOOGLE_OIDC_CLIENT_ID = 'env-client-id';
    process.env.GOOGLE_OIDC_CLIENT_SECRET = 'env-secret';

    const config = loadGoogleOAuthSecrets(oauthFile);
    expect(config.clientId).toBe('env-client-id');
    expect(config.clientSecret).toBe('env-secret');
    expect(config.redirectUri).toBe('http://file-redirect');
  });

  it('loads service account and provides token provider', () => {
    const saFile = path.join(tmpDir, 'google-service-account.json');
    fs.writeFileSync(
      saFile,
      JSON.stringify({
        type: 'service_account',
        project_id: 'test-project',
        client_email: 'test@test-project.iam.gserviceaccount.com',
        private_key: 'fake-private-key',
      })
    );

    const result = loadGoogleServiceAccountCredentials(saFile);
    expect(result.serviceAccountPath).toBe(saFile);
    expect(typeof result.tokenProvider).toBe('function');
  });

  it('falls back to GOOGLE_ACCESS_TOKEN if no service account file exists', async () => {
    process.env.GOOGLE_ACCESS_TOKEN = 'manual-bearer-token';
    const result = loadGoogleServiceAccountCredentials(path.join(tmpDir, 'none.json'));
    expect(result.serviceAccountPath).toBeUndefined();
    expect(result.tokenProvider).toBeDefined();
    const token = await result.tokenProvider!();
    expect(token).toBe('manual-bearer-token');
  });

  it('loadAllGoogleCredentials aggregates both loaders', () => {
    const result = loadAllGoogleCredentials();
    expect(result).toHaveProperty('oauthConfig');
  });
});
