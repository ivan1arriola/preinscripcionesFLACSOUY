import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from './client.js';

class FakeXhr {
  static instances: FakeXhr[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = '';
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
}

describe('apiClient.upload with progress', () => {
  let file: File;

  beforeEach(() => {
    file = new File(['contenido'], 'cv.pdf', { type: 'application/pdf' });
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports the bytes sent and resolves with the file token', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const progress = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uploadId: 'partial-1', offset: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 't1', fieldKey: 'cv', originalName: 'cv.pdf', size: 9, mimeType: 'application/pdf' }) });
    vi.stubGlobal('fetch', fetchMock);
    const promise = apiClient.upload('target-1', 'cv', file, progress);
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const request = FakeXhr.instances[0]!;

    expect(request.method).toBe('PATCH');
    expect(request.url).toContain('/api/uploads/resumable/partial-1');
    expect(request.headers['x-preinscription-session']).toBeTruthy();

    now.mockReturnValue(1050);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 9 });
    request.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
    expect(progress).toHaveBeenLastCalledWith(33, 0.1);

    request.status = 204;
    request.onload?.();

    await expect(promise).resolves.toMatchObject({ token: 't1' });
    expect(progress).toHaveBeenLastCalledWith(100, 0);
  });

  it('rejects with the API message when the server refuses the file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 'INVALID_MIME_TYPE', message: 'Tipo de archivo no permitido.' } }) }));
    const promise = apiClient.upload('target-1', 'cv', file, vi.fn());

    await expect(promise).rejects.toMatchObject({ status: 400, code: 'INVALID_MIME_TYPE', message: 'Tipo de archivo no permitido.' });
  });

  it('rejects with a clear message when the connection fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploadId: 'partial-error', offset: 0 }) }));
    const promise = apiClient.upload('target-1', 'cv', file, vi.fn());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances.at(-1)!.onerror?.();

    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toMatch(/conexión/i);
  });

  it('queries the confirmed offset and continues the same upload after a connection failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uploadId: 'partial-1', offset: 0 }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'Upload-Offset': '5' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'done' }) });
    vi.stubGlobal('fetch', fetchMock);
    const resumableFile = new File(['0123456789'], 'cv.pdf', { type: 'application/pdf' });

    const first = apiClient.upload('target-1', 'cv', resumableFile, vi.fn());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances.at(-1)!.onerror?.();
    await expect(first).rejects.toThrow(/conexión/i);

    const resumed = apiClient.upload('target-1', 'cv', resumableFile, vi.fn());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    const resumedRequest = FakeXhr.instances.at(-1)!;
    expect(resumedRequest.headers['Content-Range']).toBe('bytes 5-9/10');
    resumedRequest.status = 204;
    resumedRequest.onload?.();
    await expect(resumed).resolves.toMatchObject({ token: 'done' });
  });

  it('fails instead of restarting at 0 when the HEAD response has no valid Upload-Offset', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uploadId: 'partial-2', offset: 0 }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    const brokenFile = new File(['0123456789'], 'cv.pdf', { type: 'application/pdf' });

    const first = apiClient.upload('target-1', 'cv', brokenFile, vi.fn());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances.at(-1)!.onerror?.();
    await expect(first).rejects.toThrow(/conexión/i);

    await expect(apiClient.upload('target-1', 'cv', brokenFile, vi.fn())).rejects.toThrow(/avance/i);
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it('keeps using fetch when no progress callback is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 't2' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.upload('target-1', 'cv', file)).resolves.toEqual({ token: 't2' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
