import { describe, expect, it, vi } from 'vitest';
import { MauticClient, MauticError } from './mautic-client.js';

const credentials = { baseUrl: 'https://mautic.flacso.edu.uy/', clientId: 'public', clientSecret: 'secret' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Responde el token y luego delega cada llamada a la API en `api`. */
function fakeFetch(api: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string, init: RequestInit) =>
    url.endsWith('/oauth/v2/token') ? json(200, { access_token: 'tok-1', expires_in: 3600 }) : api(url, init)
  );
}

describe('MauticClient', () => {
  it('rejects incomplete credentials as a permanent error', () => {
    expect(() => new MauticClient({ ...credentials, clientSecret: ' ' })).toThrow(MauticError);
  });

  it('caches the OAuth2 token and sends it as Bearer', async () => {
    const fetchMock = fakeFetch(() => json(200, { contacts: {} }));
    const client = new MauticClient(credentials, { fetch: fetchMock });

    await client.verify();
    await client.verify();

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/oauth/v2/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(String(tokenCalls[0]![1].body)).toContain('grant_type=client_credentials');
    expect((fetchMock.mock.calls[1]![1].headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://mautic.flacso.edu.uy/api/contacts?limit=1');
  });

  it('renews the token once when the API answers 401', async () => {
    let apiCalls = 0;
    const fetchMock = fakeFetch(() => (++apiCalls === 1 ? json(401, {}) : json(200, { contacts: {} })));
    await new MauticClient(credentials, { fetch: fetchMock }).verify();

    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/oauth/v2/token'))).toHaveLength(2);
  });

  it('updates an existing contact matched by exact email and adds tags', async () => {
    const fetchMock = fakeFetch((_url, init) => {
      if (init.method === 'GET') {
        return json(200, {
          contacts: {
            7: { id: 7, fields: { all: { email: 'otra.valeria@example.com' } } },
            9: { id: 9, fields: { all: { email: 'valeria@example.com' } } },
          },
        });
      }
      return json(200, { contact: { id: 9 } });
    });

    const id = await new MauticClient(credentials, { fetch: fetchMock })
      .upsertContact(' Valeria@Example.com ', { firstname: 'Valeria' }, ['origen-preinscripciones', 'origen-preinscripciones']);

    expect(id).toBe(9);
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('https://mautic.flacso.edu.uy/api/contacts/9/edit');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      firstname: 'Valeria',
      email: 'valeria@example.com',
      tags: ['origen-preinscripciones'],
    });
  });

  it('creates the contact when it does not exist', async () => {
    const fetchMock = fakeFetch((_url, init) =>
      init.method === 'GET' ? json(200, { total: 0, contacts: [] }) : json(201, { contact: { id: 31 } })
    );

    await expect(new MauticClient(credentials, { fetch: fetchMock }).upsertContact('nuevo@example.com')).resolves.toBe(31);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://mautic.flacso.edu.uy/api/contacts/new');
  });

  it('sends a template with per-delivery tokens', async () => {
    const fetchMock = fakeFetch(() => json(200, { success: true }));
    await new MauticClient(credentials, { fetch: fetchMock }).sendTemplateEmail(12, 31, { '{preinscripcion_id}': 'sub_1' });

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('https://mautic.flacso.edu.uy/api/emails/12/contact/31/send');
    expect(JSON.parse(String(init.body))).toEqual({ tokens: { '{preinscripcion_id}': 'sub_1' } });
  });

  it.each([
    ['a 4xx rejection', () => json(400, { errors: [{ message: 'bad' }] }), 'permanent'],
    ['a 5xx during send', () => json(502, {}), 'unknown'],
    ['a network failure during send', () => { throw new TypeError('fetch failed'); }, 'unknown'],
    ['success: false', () => json(200, { success: false }), 'permanent'],
    ['a response without success flag', () => json(200, {}), 'unknown'],
  ])('classifies %s when sending', async (_label, api, classification) => {
    const client = new MauticClient(credentials, { fetch: fakeFetch(api as () => Response) });
    await expect(client.sendTemplateEmail(12, 31, {})).rejects.toMatchObject({ classification });
  });

  it('classifies a 5xx outside of sending as retryable', async () => {
    const client = new MauticClient(credentials, { fetch: fakeFetch(() => json(503, {})) });
    await expect(client.upsertContact('valeria@example.com')).rejects.toMatchObject({ classification: 'retryable' });
  });
});
