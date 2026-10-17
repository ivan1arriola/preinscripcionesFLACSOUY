import crypto from 'node:crypto';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createRegistrationCheckRoutes, isValidFlacsoSignature } from './registration-check-routes.js';

describe('internal registration check authentication', () => {
  const body = Buffer.from('{"email":"a@example.org","target_id":"target-1"}');
  const secret = 'configured-test-secret';
  const timestamp = '1800000000';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body.toString('utf8')}`).digest('hex')}`;

  it('accepts a valid signature within the five minute window', () => {
    expect(isValidFlacsoSignature({ rawBody: body, timestamp, signature, secret, nowSeconds: 1_800_000_100 })).toBe(true);
  });
  it('rejects a changed body, expired timestamp, malformed signature, and absent raw body', () => {
    expect(isValidFlacsoSignature({ rawBody: Buffer.concat([body, Buffer.from(' ')]), timestamp, signature, secret, nowSeconds: 1_800_000_100 })).toBe(false);
    expect(isValidFlacsoSignature({ rawBody: body, timestamp, signature, secret, nowSeconds: 1_800_000_301 })).toBe(false);
    expect(isValidFlacsoSignature({ rawBody: body, timestamp, signature: 'sha256=bad', secret, nowSeconds: 1_800_000_100 })).toBe(false);
    expect(isValidFlacsoSignature({ timestamp, signature, secret, nowSeconds: 1_800_000_100 })).toBe(false);
  });

  it('serves the POST check only after authenticating the raw body', async () => {
    const lookup = { hasEffectiveRegistration: async (email: string, targetId: string) => email === 'a@example.org' && targetId === 'target-1' };
    const app = express();
    app.use(express.json({ verify: (req, _res, buffer) => { (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
    app.use('/api/v1/internal/registrations', createRegistrationCheckRoutes(lookup, secret));
    const server: Server = createServer(app).listen(0);
    await once(server, 'listening');
    try {
      const { port } = server.address() as { port: number };
      const timestampNow = Math.floor(Date.now() / 1000).toString();
      const requestBody = JSON.stringify({ email: ' A@example.org ', target_id: 'target-1' });
      const requestSignature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestampNow}.${requestBody}`).digest('hex')}`;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/internal/registrations/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flacso-timestamp': timestampNow, 'x-flacso-signature': requestSignature },
        body: requestBody,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ has_effective_registration: true, target_id: 'target-1' });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
