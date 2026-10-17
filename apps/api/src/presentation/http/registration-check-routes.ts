import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { RegistrationLookup } from '../../ports/registration-lookup.js';

const CheckSchema = z.object({ email: z.string().trim().email().max(254), target_id: z.string().trim().min(1).max(255) });
type RequestWithRawBody = { rawBody?: Buffer };

export function isValidFlacsoSignature(input: {
  rawBody?: Buffer; timestamp: string | undefined; signature: string | undefined;
  secret: string; nowSeconds?: number;
}): boolean {
  if (!input.rawBody || !input.timestamp || !input.signature || !/^\d{10}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs((input.nowSeconds ?? Math.floor(Date.now() / 1000)) - timestamp) > 300) return false;
  const supplied = input.signature.replace(/^sha256=/, '');
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = crypto.createHmac('sha256', input.secret).update(`${input.timestamp}.${input.rawBody.toString('utf8')}`).digest();
  const actual = Buffer.from(supplied, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createRegistrationCheckRoutes(lookup: RegistrationLookup, secret?: string): Router {
  const router = Router();
  router.post('/check', async (req, res) => {
    if (!secret) {
      res.status(503).json({ error: { code: 'INTEGRATION_NOT_CONFIGURED' } });
      return;
    }
    if (!isValidFlacsoSignature({
      rawBody: (req as typeof req & RequestWithRawBody).rawBody,
      timestamp: req.header('x-flacso-timestamp'),
      signature: req.header('x-flacso-signature'),
      secret,
    })) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
      return;
    }
    const parsed = CheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST' } });
      return;
    }
    try {
      const hasEffectiveRegistration = await lookup.hasEffectiveRegistration(
        parsed.data.email.trim().toLowerCase(), parsed.data.target_id
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({ has_effective_registration: hasEffectiveRegistration, target_id: parsed.data.target_id });
    } catch {
      res.status(503).json({ error: { code: 'REGISTRATION_LOOKUP_UNAVAILABLE' } });
    }
  });
  return router;
}
