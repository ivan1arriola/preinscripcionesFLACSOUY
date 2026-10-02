import { describe, it, expect, vi } from 'vitest';
import { GoogleIdentityVerifier } from './google-oidc.js';

describe('GoogleIdentityVerifier', () => {
  it('successfully verifies a valid authorization code for web@flacso.edu.uy with verified email and matching nonce', async () => {
    const mockExchange = vi.fn().mockResolvedValue({
      sub: 'google-sub-123',
      email: 'web@flacso.edu.uy',
      email_verified: true,
      name: 'FLACSO Uruguay Web',
      picture: 'https://flacso.edu.uy/avatar.png',
      nonce: 'expected-nonce-xyz',
      aud: 'client-id-123.apps.googleusercontent.com',
      iss: 'https://accounts.google.com',
    });

    const verifier = new GoogleIdentityVerifier({
      clientId: 'client-id-123.apps.googleusercontent.com',
      clientSecret: 'secret-xyz',
      exchangeImpl: mockExchange,
    });

    const identity = await verifier.verify({
      code: 'valid-auth-code',
      redirectUri: 'https://preinscripciones.flacso.edu.uy/admin/callback',
      expectedNonce: 'expected-nonce-xyz',
    });

    expect(identity.sub).toBe('google-sub-123');
    expect(identity.email).toBe('web@flacso.edu.uy');
    expect(identity.emailVerified).toBe(true);
    expect(identity.name).toBe('FLACSO Uruguay Web');
    expect(identity.picture).toBe('https://flacso.edu.uy/avatar.png');
  });

  it('rejects when email is unverified', async () => {
    const mockExchange = vi.fn().mockResolvedValue({
      sub: 'google-sub-unverified',
      email: 'web@flacso.edu.uy',
      email_verified: false,
      name: 'Unverified Web',
      nonce: 'nonce-1',
      aud: 'client-id-123',
      iss: 'https://accounts.google.com',
    });

    const verifier = new GoogleIdentityVerifier({
      clientId: 'client-id-123',
      exchangeImpl: mockExchange,
    });

    await expect(
      verifier.verify({
        code: 'auth-code',
        redirectUri: 'https://preinscripciones.flacso.edu.uy/admin/callback',
        expectedNonce: 'nonce-1',
      })
    ).rejects.toThrow(/unverified/i);
  });

  it('rejects when nonce does not match', async () => {
    const mockExchange = vi.fn().mockResolvedValue({
      sub: 'google-sub-123',
      email: 'web@flacso.edu.uy',
      email_verified: true,
      name: 'FLACSO Web',
      nonce: 'different-nonce',
      aud: 'client-id-123',
      iss: 'https://accounts.google.com',
    });

    const verifier = new GoogleIdentityVerifier({
      clientId: 'client-id-123',
      exchangeImpl: mockExchange,
    });

    await expect(
      verifier.verify({
        code: 'auth-code',
        redirectUri: 'https://preinscripciones.flacso.edu.uy/admin/callback',
        expectedNonce: 'expected-nonce-xyz',
      })
    ).rejects.toThrow(/nonce/i);
  });

  it('rejects when audience (client ID) does not match', async () => {
    const mockExchange = vi.fn().mockResolvedValue({
      sub: 'google-sub-123',
      email: 'web@flacso.edu.uy',
      email_verified: true,
      name: 'FLACSO Web',
      aud: 'wrong-client-id',
      iss: 'https://accounts.google.com',
    });

    const verifier = new GoogleIdentityVerifier({
      clientId: 'client-id-123',
      exchangeImpl: mockExchange,
    });

    await expect(
      verifier.verify({
        code: 'auth-code',
        redirectUri: 'https://preinscripciones.flacso.edu.uy/admin/callback',
      })
    ).rejects.toThrow(/audience/i);
  });

  it('rejects when issuer is not Google', async () => {
    const mockExchange = vi.fn().mockResolvedValue({
      sub: 'google-sub-123',
      email: 'web@flacso.edu.uy',
      email_verified: true,
      name: 'FLACSO Web',
      aud: 'client-id-123',
      iss: 'https://evil.example.com',
    });

    const verifier = new GoogleIdentityVerifier({
      clientId: 'client-id-123',
      exchangeImpl: mockExchange,
    });

    await expect(
      verifier.verify({
        code: 'auth-code',
        redirectUri: 'https://preinscripciones.flacso.edu.uy/admin/callback',
      })
    ).rejects.toThrow(/issuer/i);
  });
});
