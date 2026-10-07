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

  it('inserts exactly one row below the header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpGoogleSheetsClient({ accessTokenOrProvider: 'token' });

    await client.insertRows('sheet-1', 123, 1, 2);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sheets.googleapis.com/v4/spreadsheets/sheet-1:batchUpdate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            insertDimension: {
              range: { sheetId: 123, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
              inheritFromBefore: false,
            },
          }],
        }),
      }),
    );
  });

  it('retries on HTTP 429 and succeeds on subsequent attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'retry-after': '0' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ values: [['Col1', 'Col2']] }), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpGoogleSheetsClient({ accessTokenOrProvider: 'token' });
    const rows = await client.getValues('sheet-1', 'Sheet1!A1:B1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([['Col1', 'Col2']]);
  });
});
