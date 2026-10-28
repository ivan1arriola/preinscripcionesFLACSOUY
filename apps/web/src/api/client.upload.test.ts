import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from './client.js';

class FakeXhr {
  static last: FakeXhr;
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
    FakeXhr.last = this;
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
  const file = new File(['contenido'], 'cv.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the bytes sent and resolves with the file token', async () => {
    const progress = vi.fn();
    const promise = apiClient.upload('target-1', 'cv', file, progress);
    const request = FakeXhr.last;

    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/uploads');
    expect(request.headers['x-preinscription-session']).toBeTruthy();

    request.upload.onprogress?.({ lengthComputable: true, loaded: 250, total: 1000 });
    request.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(25);

    request.status = 201;
    request.responseText = JSON.stringify({ token: 't1', fieldKey: 'cv', originalName: 'cv.pdf', size: 9, mimeType: 'application/pdf' });
    request.onload?.();

    await expect(promise).resolves.toMatchObject({ token: 't1' });
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it('rejects with the API message when the server refuses the file', async () => {
    const promise = apiClient.upload('target-1', 'cv', file, vi.fn());
    const request = FakeXhr.last;
    request.status = 400;
    request.responseText = JSON.stringify({ error: { code: 'INVALID_MIME_TYPE', message: 'Tipo de archivo no permitido.' } });
    request.onload?.();

    await expect(promise).rejects.toMatchObject({ status: 400, code: 'INVALID_MIME_TYPE', message: 'Tipo de archivo no permitido.' });
  });

  it('rejects with a clear message when the connection fails', async () => {
    const promise = apiClient.upload('target-1', 'cv', file, vi.fn());
    FakeXhr.last.onerror?.();

    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toMatch(/conexión/i);
  });

  it('keeps using fetch when no progress callback is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 't2' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.upload('target-1', 'cv', file)).resolves.toEqual({ token: 't2' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
