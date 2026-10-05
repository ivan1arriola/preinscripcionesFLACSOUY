import { describe, expect, it, vi, afterEach } from 'vitest';
import { HttpGoogleSheetsClient } from './sheets-client.js';

describe('HttpGoogleSheetsClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('includes Google’s safe validation reason in append errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Unable to parse range: Hoja 1!A:A" },
    }), { status: 400 })));
    const client = new HttpGoogleSheetsClient({ accessTokenOrProvider: 'token' });

    await expect(client.appendValues('sheet-1', 'Hoja 1!A:A', [['value']])).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Unable to parse range: Hoja 1!A:A'),
    });
  });
});
