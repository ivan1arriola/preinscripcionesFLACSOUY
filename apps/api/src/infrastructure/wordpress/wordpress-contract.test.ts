import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WordPressClient, WordPressClientError } from './wordpress-client.js';
import { WordPressAcademicCatalog } from './wordpress-academic-catalog.js';
import { MemoryWordPressCache } from './wordpress-cache.js';

const simplifiedV1Response = {
  version: 1,
  targets: [
    {
      id: 'target_davia_c11',
      kind: 'academic_offer',
      title: 'Cohorte XI',
      wordpress: {
        offerId: 12295,
        cohortId: 1234,
      },
      offer: {
        id: 12295,
        slug: 'davia',
        name: 'Diploma Superior en Aprendizaje Visual e Inteligencia Artificial',
        type: 'diploma',
        orientations: ['Educación', 'Políticas Públicas'],
        mentions: ['Tecnología Educativa', 'Innovación Pública'],
      },
      cohort: {
        number: 11,
        name: 'Cohorte XI',
      },
      notificationEmail: 'coordinacion@flacso.edu.uy',
      registrationOpen: true,
      registrationWindow: {
        from: null,
        until: '2026-05-15T00:00:00Z',
      },
      configRevision: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      orientations: ['Educación', 'Políticas Públicas'],
      mentions: ['Tecnología Educativa', 'Innovación Pública'],
      urls: {
        public: 'https://flacso.edu.uy/ofertas/davia',
        wordpress: 'https://flacso.edu.uy/cohortes/1234',
        edit: 'https://flacso.edu.uy/wp-admin/post.php?post=1234&action=edit',
        legacyRegistration: 'https://flacso.edu.uy/legacy-davia',
      },
    },
    {
      id: 'target_metodologia_ed3',
      kind: 'seminar',
      title: 'Seminario de Investigación Cualitativa - Edición 2026-03',
      wordpress: {
        seminarId: 200,
        editionId: 201,
      },
      seminar: {
        id: 200,
        slug: 'metodologia',
        name: 'Investigación Cualitativa',
        type: 'seminar',
      },
      edition: {
        number: 3,
        name: 'Edición 2026-03',
      },
      notificationEmail: null,
      registrationOpen: false,
      registrationAvailability: 'closed',
      registrationWindow: {
        from: null,
        until: null,
      },
      configRevision: 'sha256:d41d8cd98f00b204e9800998ecf8427e',
      orientations: [],
      mentions: [],
      urls: {
        public: 'https://flacso.edu.uy/seminarios/metodologia',
        wordpress: 'https://flacso.edu.uy/ediciones/201',
        edit: 'https://flacso.edu.uy/wp-admin/post.php?post=201&action=edit',
        legacyRegistration: null,
      },
    },
    {
      id: 'target_metodologia_ed4',
      kind: 'seminar',
      title: 'Seminario de Investigación Cualitativa - Edición 2026-04',
      wordpress: {
        seminarId: 200,
        editionId: 202,
      },
      seminar: {
        id: 200,
        slug: 'metodologia',
        name: 'Investigación Cualitativa',
        type: 'seminar',
      },
      edition: {
        number: 4,
        name: 'Edición 2026-04',
      },
      registrationOpen: true,
      // Legacy target without registrationAvailability
      registrationWindow: {
        from: null,
        until: null,
      },
      configRevision: 'sha256:d41d8cd98f00b204e9800998ecf8427f',
      orientations: [],
      mentions: [],
      urls: {
        public: 'https://flacso.edu.uy/seminarios/metodologia',
        wordpress: 'https://flacso.edu.uy/ediciones/202',
        edit: 'https://flacso.edu.uy/wp-admin/post.php?post=202&action=edit',
        legacyRegistration: 'https://flacso.edu.uy/seminario/metodologia/',
      },
    },
  ],
};

describe('WordPress Client & Contract Adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully fetches and validates simplified REST v1 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => simplifiedV1Response,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    const response = await client.getPreinscriptions();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://flacso.edu.uy/wp-json/flacso/v1/preinscripciones',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
    expect(response.version).toBe(1);
    expect(response.targets).toHaveLength(3);
    expect(response.targets[0]!.id).toBe('target_davia_c11');
    expect(response.targets[0]!.offer?.type).toBe('diploma');
    expect(response.targets[0]!.orientations).toEqual(['Educación', 'Políticas Públicas']);
    expect(response.targets[0]!.mentions).toEqual(['Tecnología Educativa', 'Innovación Pública']);
    expect(response.targets[0]!.notificationEmail).toBe('coordinacion@flacso.edu.uy');
    expect(response.targets[1]!.registrationOpen).toBe(false);
    expect(response.targets[1]!.registrationAvailability).toBe('closed');
    expect(response.targets[1]!.notificationEmail).toBeNull();
    expect(response.targets[1]!.seminar?.type).toBe('seminar');
    expect(response.targets[2]!.registrationOpen).toBe(true);
    expect(response.targets[2]!.registrationAvailability).toBeUndefined();
    expect(response.targets[2]!.notificationEmail).toBeUndefined();
  });

  it('reads published agreements from the native WordPress REST endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: 42, title: { rendered: 'Convenio Universidad de la República' } },
        { id: 67, title: { rendered: 'Convenio ANEP' } },
        { id: 89, title: { rendered: 'Antígona &#8211; Asociación Civil' } },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });

    await expect(client.getAgreements()).resolves.toEqual([
      { id: '42', label: 'Convenio Universidad de la República' },
      { id: '67', label: 'Convenio ANEP' },
      { id: '89', label: 'Antígona – Asociación Civil' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://flacso.edu.uy/wp-json/wp/v2/convenio?per_page=100&_fields=id,title',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('rejects WordPress records that try to supply objects with IDs in orientations', async () => {
    const legacyOrientationResponse = {
      version: 1,
      targets: [
        {
          ...simplifiedV1Response.targets[0],
          orientations: [{ id: 'educacion', name: 'Educación' }],
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => legacyOrientationResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    await expect(client.getPreinscriptions()).rejects.toThrow();
  });

  it('rejects WordPress records that try to supply objects with IDs in mentions', async () => {
    const legacyMentionResponse = {
      version: 1,
      targets: [
        {
          ...simplifiedV1Response.targets[0],
          mentions: [{ id: 'tec-edu', name: 'Tecnología Educativa' }],
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => legacyMentionResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    await expect(client.getPreinscriptions()).rejects.toThrow();
  });

  it('rejects academic_offer records missing offer.type', async () => {
    const invalidTargetResponse = {
      version: 1,
      targets: [
        {
          ...simplifiedV1Response.targets[0],
          offer: {
            id: 12295,
            slug: 'davia',
            name: 'DAVIA',
            // missing type
          },
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => invalidTargetResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    await expect(client.getPreinscriptions()).rejects.toThrow();
  });

  it('rejects HTTP non-200 responses with safe redacted error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'Secret admin trace',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    await expect(client.getPreinscriptions()).rejects.toThrow(WordPressClientError);
  });

  it('rejects invalid JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    await expect(client.getPreinscriptions()).rejects.toThrow(/JSON/);
  });

  it('rejects unknown contract version', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...simplifiedV1Response, version: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    await expect(client.getPreinscriptions()).rejects.toThrow(/version/);
  });

  it('caches targets and uses stale cache on upstream failure', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => simplifiedV1Response,
        };
      }
      throw new Error('Connection refused');
    });
    vi.stubGlobal('fetch', fetchMock);

    const cache = new MemoryWordPressCache();
    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    const catalog = new WordPressAcademicCatalog(client, cache, { ttlSeconds: 60 });

    // First call: populates cache
    const targets1 = await catalog.listTargets();
    expect(targets1).toHaveLength(3);
    expect(targets1[0]!.mentions).toEqual([
      'Tecnología Educativa',
      'Innovación Pública',
    ]);
    expect(targets1[0]!.title).toBe('Diploma Superior en Aprendizaje Visual e Inteligencia Artificial — Cohorte XI');
    expect(targets1[0]!.notificationEmail).toBe('coordinacion@flacso.edu.uy');
    expect(targets1[1]!.registrationAvailability).toBe('closed');
    expect(targets1[1]!.notificationEmail).toBeUndefined();
    expect(targets1[2]!.registrationAvailability).toBeUndefined();
    expect(targets1[2]!.notificationEmail).toBeUndefined();

    // Second call: upstream fails, but cache provides targets
    const targets2 = await catalog.listTargets();
    expect(targets2).toHaveLength(3);
    expect(targets2[0]!.id).toBe('target_davia_c11');
  });

  it('serves stale targets immediately while refreshing an unavailable upstream in the background', async () => {
    let callCount = 0;
    let resolveRefresh!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => simplifiedV1Response,
        };
      }
      return new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const cache = new MemoryWordPressCache();
    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    const catalog = new WordPressAcademicCatalog(client, cache, { ttlSeconds: -1 });

    await catalog.listTargets();
    const staleTargets = await Promise.race([
      catalog.listTargets(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stale cache was not served immediately')), 100)),
    ]);

    expect(staleTargets).toHaveLength(3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveRefresh({
      ok: false,
      status: 504,
      json: async () => ({}),
    } as Response);
  });

  it('rejects targets with invalid notificationEmail format', async () => {
    const invalidEmailResponse = {
      version: 1,
      targets: [
        {
          ...simplifiedV1Response.targets[0],
          notificationEmail: 'not-an-email',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => invalidEmailResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    await expect(client.getPreinscriptions()).rejects.toThrow();
  });

  it('revalidates single target bypassing cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => simplifiedV1Response,
    });
    vi.stubGlobal('fetch', fetchMock);

    const cache = new MemoryWordPressCache();
    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    const catalog = new WordPressAcademicCatalog(client, cache);

    const target = await catalog.revalidateTarget('target_davia_c11');
    expect(target).not.toBeNull();
    expect(target?.id).toBe('target_davia_c11');

    const notFound = await catalog.revalidateTarget('non_existent');
    expect(notFound).toBeNull();
  });
});
