import { OAuth2Client } from 'google-auth-library';

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

export interface VerifyGoogleParams {
  code: string;
  redirectUri: string;
  expectedNonce?: string;
}

export type GoogleTokenExchangeImpl = (params: {
  code: string;
  redirectUri: string;
}) => Promise<{
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  nonce?: string;
  aud?: string;
  iss?: string;
}>;

export interface GoogleIdentityVerifierOptions {
  clientId: string;
  clientSecret?: string;
  exchangeImpl?: GoogleTokenExchangeImpl;
}

export interface GoogleIdentityVerifierPort {
  verify(params: VerifyGoogleParams): Promise<VerifiedGoogleIdentity>;
  generateAuthUrl?(redirectUri: string, state: string, nonce: string): string;
}

export class GoogleIdentityVerifier implements GoogleIdentityVerifierPort {
  private readonly client: OAuth2Client;
  private readonly clientId: string;
  private readonly exchangeImpl?: GoogleTokenExchangeImpl;

  constructor(options: GoogleIdentityVerifierOptions) {
    this.clientId = options.clientId;
    this.exchangeImpl = options.exchangeImpl;
    this.client = new OAuth2Client({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    });
  }

  generateAuthUrl(redirectUri: string, state: string, nonce: string): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'profile', 'email'],
      redirect_uri: redirectUri,
      state,
      nonce,
      prompt: 'select_account',
    });
  }

  async verify(params: VerifyGoogleParams): Promise<VerifiedGoogleIdentity> {
    let payload: {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
      nonce?: string;
      aud?: string;
      iss?: string;
    };

    if (this.exchangeImpl) {
      payload = await this.exchangeImpl({
        code: params.code,
        redirectUri: params.redirectUri,
      });
    } else {
      const { tokens } = await this.client.getToken({
        code: params.code,
        redirect_uri: params.redirectUri,
      });

      if (!tokens.id_token) {
        throw new Error('Google OAuth did not return an id_token');
      }

      const ticket = await this.client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.clientId,
      });

      const tokenPayload = ticket.getPayload();
      if (!tokenPayload) {
        throw new Error('Empty payload in Google ID token');
      }
      payload = tokenPayload;
    }

    // 1. Verify issuer
    if (
      payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com'
    ) {
      throw new Error(`Invalid issuer in token: ${payload.iss}`);
    }

    // 2. Verify audience
    if (payload.aud !== this.clientId) {
      throw new Error(`Invalid audience in token: ${payload.aud}`);
    }

    // 3. Verify email_verified
    if (!payload.email_verified) {
      throw new Error('Google email is unverified');
    }

    // 4. Verify nonce if expected
    if (params.expectedNonce && payload.nonce !== params.expectedNonce) {
      throw new Error('Invalid nonce in identity token');
    }

    if (!payload.sub || !payload.email) {
      throw new Error('Missing sub or email in Google ID token');
    }

    return {
      sub: payload.sub,
      email: payload.email.toLowerCase().trim(),
      emailVerified: true,
      name: payload.name || payload.email,
      picture: payload.picture,
    };
  }
}
