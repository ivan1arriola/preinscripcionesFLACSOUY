import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WordPressClient, WordPressClientError } from './wordpress-client.js';
import { WordPressAcademicCatalog } from './wordpress-academic-catalog.js';
import { MemoryWordPressCache } from './wordpress-cache.js';

const frozenV1Response = {
  version: 1,
  targets: [
    {
      id: 'target_davia_c11',
      kind: 'academic_offer',
      title: 'Diploma Superior en Aprendizaje Visual e Inteligencia Artificial - Cohorte 11',
      wordpress: {
        offerId: 12295,
        cohortId: 1234,
      },
      offer: {
        id: 12295,
        slug: 'davia',
        name: 'DAVIA',
      },
      cohort: {
        number: 11,
        name: 'Cohorte XI',
      },
      registrationOpen: true,
      registrationWindow: {
        from: null,
        until: '2026-05-15T00:00:00Z',
      },
      configRevision: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      form: {
        valid: true,
        inputs: [
          { key: 'documento', position: 10, required: true },
          { key: 'orientacion', position: 20, required: true },
          { key: 'mencion', position: 30, required: false },
        ],
      },
      orientations: [
        {
          id: 'educacion',
          name: 'Educación',
          mentions: [{ id: 'tec-edu', name: 'Tecnología Educativa' }],
        },
      ],
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
      },
      edition: {
        number: 3,
        name: 'Edición 2026-03',
      },
      registrationOpen: false,
      registrationWindow: {
        from: null,
        until: null,
      },
      configRevision: 'sha256:d41d8cd98f00b204e9800998ecf8427e',
      form: {
        valid: true,
        inputs: [{ key: 'documento', position: 10, required: true }],
      },
      orientations: [],
      urls: {
        public: 'https://flacso.edu.uy/seminarios/metodologia',
        wordpress: 'https://flacso.edu.uy/ediciones/201',
        edit: 'https://flacso.edu.uy/wp-admin/post.php?post=201&action=edit',
        legacyRegistration: null,
      },
    },
  ],
};

describe('WordPress Client & Contract Adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully fetches and validates frozen REST v1 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => frozenV1Response,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WordPressClient({ baseUrl: 'https://flacso.edu.uy' });
    const response = await client.getPreinscriptions();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://flacso.edu.uy/wp-json/flacso/v1/preinscripciones',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
    expect(response.version).toBe(1);
    expect(response.targets).toHaveLength(2);
    expect(response.targets[0]!.id).toBe('target_davia_c11');
    expect(response.targets[0]!.registrationOpen).toBe(true);
    expect(response.targets[1]!.registrationOpen).toBe(false);
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
      json: async () => ({ ...frozenV1Response, version: 2 }),
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
          json: async () => frozenV1Response,
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
    expect(targets1).toHaveLength(2);

    // Second call: upstream fails, but cache provides targets
    const targets2 = await catalog.listTargets();
    expect(targets2).toHaveLength(2);
    expect(targets2[0]!.id).toBe('target_davia_c11');
  });

  it('revalidates single target bypassing cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => frozenV1Response,
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
