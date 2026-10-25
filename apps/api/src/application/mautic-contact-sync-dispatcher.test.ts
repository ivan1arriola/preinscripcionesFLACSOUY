import { describe, expect, it, vi } from 'vitest';
import { MAX_SYNC_ATTEMPTS, syncBackoffSeconds, syncContact } from './mautic-contact-sync-dispatcher.js';
import { MauticError } from '../infrastructure/mautic/mautic-client.js';

const payload = JSON.stringify({
  email: 'valeria@example.com',
  fields: { firstname: 'Valeria' },
  tags: ['preinscripcion-mg', 'origen-preinscripciones'],
});

function client(result: () => Promise<number>) {
  return { upsertContact: vi.fn(result) };
}

describe('syncContact', () => {
  it('upserts the contact with its fields and tags', async () => {
    const mautic = client(async () => 31);
    await expect(syncContact(payload, mautic, 1)).resolves.toEqual({ status: 'synced', contactId: 31 });
    expect(mautic.upsertContact).toHaveBeenCalledWith(
      'valeria@example.com',
      { firstname: 'Valeria' },
      ['preinscripcion-mg', 'origen-preinscripciones'],
    );
  });

  it.each([
    ['network', new MauticError('down', 'retryable'), 'mautic_unavailable'],
    ['5xx', new MauticError('down', 'retryable', 503), 'mautic_http_503'],
    ['401 (credentials may be rotating)', new MauticError('auth', 'permanent', 401), 'mautic_http_401'],
  ])('retries on %s', async (_label, error, safeCode) => {
    await expect(syncContact(payload, client(async () => { throw error; }), 1)).resolves.toEqual({ status: 'retry', safeCode });
  });

  it('fails permanently on a data rejection', async () => {
    const outcome = await syncContact(payload, client(async () => { throw new MauticError('bad', 'permanent', 422); }), 1);
    expect(outcome).toEqual({ status: 'failed', safeCode: 'mautic_http_422' });
  });

  it('gives up after the maximum number of attempts', async () => {
    const outcome = await syncContact(payload, client(async () => { throw new MauticError('down', 'retryable'); }), MAX_SYNC_ATTEMPTS);
    expect(outcome.status).toBe('failed');
  });

  it('never retries an unreadable payload', async () => {
    await expect(syncContact('{', client(async () => 1), 1)).resolves.toEqual({ status: 'failed', safeCode: 'invalid_payload' });
  });

  it('backs off exponentially up to one hour', () => {
    expect([1, 2, 3].map(syncBackoffSeconds)).toEqual([5, 10, 20]);
    expect(syncBackoffSeconds(19)).toBe(3600);
  });
});
