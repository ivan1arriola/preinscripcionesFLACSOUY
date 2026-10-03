import { describe, expect, it, vi } from 'vitest';
import { GoogleSpreadsheetProvisioner } from './google-spreadsheet-provisioner.js';
import type { SheetsClient } from './sheets-client.js';

describe('GoogleSpreadsheetProvisioner', () => {
  it('creates the spreadsheet inside the configured Drive folder and writes headers', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'created-sheet-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sheets: [{ properties: { title: 'Hoja 1' } }] }), { status: 200 }));
    const sheetsClient: SheetsClient = {
      getValues: vi.fn(),
      appendValues: vi.fn(),
      updateValues: vi.fn().mockResolvedValue(undefined),
    };
    const provisioner = new GoogleSpreadsheetProvisioner({
      accessTokenOrProvider: 'token-1',
      sheetsClient,
      fetchImpl,
    });

    const result = await provisioner.create({
      title: 'Maestría — Cohorte 1',
      folderId: 'drive-root-1',
      sheetName: 'Sheet1',
      headers: ['Correo electrónico', 'Primer nombre'],
    });

    expect(result).toEqual({
      spreadsheetId: 'created-sheet-1',
      sheetName: 'Hoja 1',
      url: 'https://docs.google.com/spreadsheets/d/created-sheet-1/edit',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('https://www.googleapis.com/drive/v3/files'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Maestría — Cohorte 1',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: ['drive-root-1'],
        }),
      }),
    );
    expect(sheetsClient.updateValues).toHaveBeenCalledWith(
      'created-sheet-1',
      "'Hoja 1'!A1",
      [['Correo electrónico', 'Primer nombre']],
    );
  });

  it('explains when a service account cannot create files in My Drive', async () => {
    const provisioner = new GoogleSpreadsheetProvisioner({
      accessTokenOrProvider: 'token',
      sheetsClient: {
        getValues: async () => [],
        appendValues: async () => ({ updatedRange: 'unused', updatedRows: 0 }),
        updateValues: async () => undefined,
      },
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          message: "The user's Drive storage quota has been exceeded.",
          errors: [{ reason: 'storageQuotaExceeded' }],
        },
      }), { status: 403 }),
    });

    await expect(provisioner.create({
      folderId: 'folder-1',
      title: 'Inscripciones',
      sheetName: 'Datos',
      headers: ['Nombre'],
    })).rejects.toThrow('Unidad compartida');
  });
});
