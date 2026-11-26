import { describe, expect, it, vi } from 'vitest';
import { createGa4Tracker, createGa4TrackerFromEnv, readGaClientId, readGaSessionId } from './ga4-measurement-protocol.js';

describe('ga4-measurement-protocol', () => {
  it('lee el client_id y la sesión de las cookies de GA4', () => {
    expect(readGaClientId('a=1; _ga=GA1.1.123.456')).toBe('123.456');
    expect(readGaClientId('_ga=basura')).toBeUndefined();
    expect(readGaSessionId('_ga_ABC123=GS1.1.99.1.1.2.0.0.0', 'G-ABC123')).toBe('99');
    expect(readGaSessionId('_ga_ABC123=GS2.1.s88$o1$g1', 'G-ABC123')).toBe('88');
    expect(readGaSessionId('_ga_OTRA=GS1.1.99.1', 'G-ABC123')).toBeUndefined();
  });

  it('envía submit_application con el client_id del navegador y sin datos personales', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 204 }));
    const tracker = createGa4Tracker({ measurementId: 'G-ABC123', apiSecret: 's3cr3t', fetch: fetchMock as never });
    await tracker.sendSubmitApplication({ eventId: 'sub-1', contentName: 'Diploma', offerCode: 'dgen', cookieHeader: '_ga=GA1.1.11.22; _ga_ABC123=GS1.1.99.1.1.2.0.0.0' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.google-analytics.com/mp/collect?measurement_id=G-ABC123&api_secret=s3cr3t');
    const body = JSON.parse(String(init.body));
    expect(body.client_id).toBe('11.22');
    expect(body.events[0]).toMatchObject({ name: 'submit_application', params: { content_name: 'Diploma', offer_code: 'dgen', session_id: '99', flacso_event_id: 'sub-1' } });
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it('sin cookie _ga deriva un client_id estable', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 204 }));
    const tracker = createGa4Tracker({ measurementId: 'G-ABC123', apiSecret: 'x', fetch: fetchMock as never });
    await tracker.sendSubmitApplication({ eventId: 'sub-2' });
    await tracker.sendSubmitApplication({ eventId: 'sub-2' });
    const id = (i: number) => JSON.parse(String((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body)).client_id;
    expect(id(0)).toMatch(/^\d+\.\d+$/);
    expect(id(0)).toBe(id(1));
  });

  it('nunca lanza si GA4 falla y se arma solo con ambas variables', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tracker = createGa4Tracker({ measurementId: 'G-A', apiSecret: 'x', fetch: (async () => { throw new Error('red'); }) as never });
    await expect(tracker.sendSubmitApplication({ eventId: 'x' })).resolves.toBeUndefined();
    expect(createGa4TrackerFromEnv({ GA4_MEASUREMENT_ID: 'G-A' } as never)).toBeUndefined();
    expect(createGa4TrackerFromEnv({ GA4_MEASUREMENT_ID: 'G-A', GA4_API_SECRET: 'x' } as never)?.measurementId).toBe('G-A');
  });
});
