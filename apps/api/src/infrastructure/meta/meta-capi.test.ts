import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createMetaCapiTracker, createMetaCapiTrackerFromEnv, readMetaCookies } from './meta-capi.js';

describe('meta-capi', () => {
  it('envía SubmitApplication con el event_id compartido y sin datos personales', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const tracker = createMetaCapiTracker({ pixelId: '123', accessToken: 'tok', fetch: fetchMock as never, now: () => 1_700_000_000_000 });

    await tracker.sendSubmitApplication({ eventId: 'sub-1', clientIp: '1.2.3.4', userAgent: 'UA', fbp: 'fb.1.2.3', contentName: 'Diploma' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v25.0/123/events');
    const payload = JSON.parse(String(init.body));
    expect(payload.data[0]).toMatchObject({ event_name: 'SubmitApplication', event_id: 'sub-1', event_time: 1_700_000_000, action_source: 'website' });
    expect(payload.data[0].user_data.external_id).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.data[0].user_data.client_ip_address).toBe('1.2.3.4');
    expect(payload.test_event_code).toBeUndefined();
  });

  it('nunca lanza si Meta falla', async () => {
    const tracker = createMetaCapiTracker({ pixelId: '1', accessToken: 't', fetch: (async () => { throw new Error('red'); }) as never });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(tracker.sendSubmitApplication({ eventId: 'x' })).resolves.toBeUndefined();
  });

  it('lee _fbp y _fbc de las cookies', () => {
    expect(readMetaCookies('a=1; _fbp=fb.1.1.1; _fbc=fb.1.2.abc')).toEqual({ fbp: 'fb.1.1.1', fbc: 'fb.1.2.abc' });
    expect(readMetaCookies(undefined)).toEqual({});
  });

  it('sin variables de entorno no hay seguimiento', () => {
    expect(createMetaCapiTrackerFromEnv({})).toBeUndefined();
    expect(createMetaCapiTrackerFromEnv({ META_PIXEL_ID: '1', META_CAPI_ACCESS_TOKEN: 't' })?.pixelId).toBe('1');
  });

  it('suma em/ph/fn/ln/country normalizados y hasheados', async () => {
    const sha = (v: string) => createHash('sha256').update(v).digest('hex');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const tracker = createMetaCapiTracker({ pixelId: '1', accessToken: 't', fetch: fetchMock as never });
    await tracker.sendSubmitApplication({ eventId: 'e', email: '  Ana.Perez@Example.COM ', phone: '+598 99 123-456', firstName: ' José ', lastName: 'PEÑA', country: 'Uruguay' });
    const u = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).data[0].user_data;
    expect(u).toMatchObject({ em: sha('ana.perez@example.com'), ph: sha('59899123456'), fn: sha('jose'), ln: sha('pena'), country: sha('uy') });
  });

  it('omite país desconocido y valores vacíos', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const tracker = createMetaCapiTracker({ pixelId: '1', accessToken: 't', fetch: fetchMock as never });
    await tracker.sendSubmitApplication({ eventId: 'e', email: '  ', phone: 'abc', firstName: '', lastName: undefined, country: 'Atlantida' });
    const u = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).data[0].user_data;
    for (const k of ['em', 'ph', 'fn', 'ln', 'country']) expect(u).not.toHaveProperty(k);
  });

  it('quita puntuación en fn/ln y omite guiones', async () => {
    const sha = (v: string) => createHash('sha256').update(v).digest('hex');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const tracker = createMetaCapiTracker({ pixelId: '1', accessToken: 't', fetch: fetchMock as never });
    await tracker.sendSubmitApplication({ eventId: 'e', firstName: '-', lastName: "O'Connor" });
    const u = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).data[0].user_data;
    expect(u).not.toHaveProperty('fn');
    expect(u.ln).toBe(sha('oconnor'));
  });
});
