import { describe, expect, it } from 'vitest';
import { GoogleDriveRepository } from './google-drive-repository.js';

describe('GoogleDriveRepository', () => {
  it('uploads files with an idempotency property and returns Drive identifiers', async () => {
    const requests: Request[] = [];
    const repository = new GoogleDriveRepository({
      folderId: 'folder-1',
      accessTokenOrProvider: 'token',
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ id: 'drive-file-1', name: 'cv.pdf' }), { status: 200 });
      },
    });

    const result = await repository.storeSubmissionFiles({
      submissionId: 'sub_1',
      files: [{ token: 'tmp-token', originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }],
    });

    expect(result.files).toEqual([{ token: 'tmp-token', driveFileId: 'drive-file-1' }]);
    const uploadRequest = requests.find((r) => r.url.includes('upload/drive/v3/files'));
    expect(uploadRequest).toBeDefined();
    expect(await uploadRequest?.text()).toContain('tmp-token');
  });

  it('fails safely without exposing credentials or pretending success', async () => {
    const repository = new GoogleDriveRepository({ folderId: 'folder-1', accessTokenOrProvider: 'token', fetchImpl: async () => new Response('denied', { status: 403 }) });
    await expect(repository.storeSubmissionFiles({ submissionId: 'sub_1', files: [{ token: 'tmp-token', originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }] })).rejects.toThrow(/HTTP 403/);
  });

  it('reads the folder name and creation capability for admin configuration', async () => {
    let request: Request | undefined;
    const repository = new GoogleDriveRepository({
      accessTokenOrProvider: 'token',
      fetchImpl: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({
          id: 'folder-1',
          name: 'Preinscripciones FLACSO',
          mimeType: 'application/vnd.google-apps.folder',
          capabilities: { canAddChildren: true },
        }), { status: 200 });
      },
    });

    await expect(repository.inspectFolder('folder-1')).resolves.toEqual({
      id: 'folder-1',
      name: 'Preinscripciones FLACSO',
      canAddChildren: true,
    });
    expect(request?.url).toContain('drive/v3/files/folder-1');
    expect(request?.url).toContain('capabilities(canAddChildren)');
  });

  it('creates the academic hierarchy and uses a semantic document name', async () => {
    const requests: Request[] = [];
    let folderNumber = 0;
    const repository = new GoogleDriveRepository({
      folderId: 'root-1',
      accessTokenOrProvider: 'token',
      fetchImpl: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.includes('/files?q=')) {
          return new Response(JSON.stringify({ files: [] }), { status: 200 });
        }
        if (request.method === 'POST' && request.url.includes('/drive/v3/files?fields=')) {
          folderNumber += 1;
          return new Response(JSON.stringify({ id: `folder-${folderNumber}` }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: 'drive-file-1', name: 'semantic.pdf' }), { status: 200 });
      },
    });

    const result = await repository.storeSubmissionFiles({
      submissionId: 'sub-1',
      target: {
        targetId: 'offer-1', kind: 'academic_offer', offerName: 'Maestría en Educación', cohortName: 'Cohorte VII',
      },
      values: { apellido1: 'Pérez', nombre1: 'Ana' },
      files: [{ token: 'tmp-token', fieldKey: 'cv', originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }],
    });

    const folderCreationRequests = requests.filter(
      (r) => r.method === 'POST' && r.url.includes('/drive/v3/files?fields=')
    );
    expect(folderCreationRequests.length).toBe(6);

    // Verify folder 4 (Preinscripciones) has parent folder-3 (Cohorte VII)
    const preinscripcionesBody = JSON.parse(await folderCreationRequests[3]!.clone().text());
    expect(preinscripcionesBody.name).toBe('Preinscripciones');
    expect(preinscripcionesBody.parents).toEqual(['folder-3']);

    // Verify folder 5 (Documentación) has parent folder-4 (Preinscripciones)
    const documentacionBody = JSON.parse(await folderCreationRequests[4]!.clone().text());
    expect(documentacionBody.name).toBe('Documentación');
    expect(documentacionBody.parents).toEqual(['folder-4']);

    // Verify folder 6 (Applicant folder) has parent folder-5 (Documentación)
    const applicantFolderBody = JSON.parse(await folderCreationRequests[5]!.clone().text());
    expect(applicantFolderBody.name).toBe('apellidos-perez__nombres-ana__sub-1');
    expect(applicantFolderBody.parents).toEqual(['folder-5']);

    expect(result.documentsFolderId).toBe('folder-6');
    expect(result.documentsFolderUrl).toBe('https://drive.google.com/drive/folders/folder-6');

    const uploadRequest = requests.find((request) => request.url.includes('/upload/drive/v3/files'));
    expect(uploadRequest).toBeDefined();
    const uploadBody = await uploadRequest?.text();
    expect(uploadBody).toContain('"parents":["folder-6"]');
    expect(uploadBody).toContain('apellidos-perez__nombres-ana__cv__sub-1.pdf');
    expect(uploadBody).toContain('flacsoTargetId');
    expect(uploadBody).toContain('flacsoFieldKey');
  });

  it('does not re-upload a file already present in Drive (idempotency)', async () => {
    const requests: Request[] = [];
    const repository = new GoogleDriveRepository({
      folderId: 'root-1',
      accessTokenOrProvider: 'token',
      fetchImpl: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        // Folder queries return existing root
        if (request.url.includes('mimeType+%3D+%27application%2Fvnd.google-apps.folder%27') || request.url.includes("mimeType = 'application/vnd.google-apps.folder'")) {
          return new Response(JSON.stringify({ files: [{ id: 'folder-existing' }] }), { status: 200 });
        }
        // File appProperties query returns existing file
        if (request.url.includes('flacsoSubmissionId') && request.url.includes('flacsoFileToken')) {
          return new Response(JSON.stringify({ files: [{ id: 'existing-drive-file-99' }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: 'should-not-upload', name: 'unused' }), { status: 200 });
      },
    });

    const result = await repository.storeSubmissionFiles({
      submissionId: 'sub-1',
      target: {
        targetId: 'offer-1', kind: 'academic_offer', offerName: 'Maestría en Educación', cohortName: 'Cohorte VII',
      },
      values: { apellido1: 'Pérez', nombre1: 'Ana' },
      files: [{ token: 'tmp-token', fieldKey: 'cv', originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }],
    });

    // Should return existing file ID
    expect(result.files).toEqual([{ token: 'tmp-token', driveFileId: 'existing-drive-file-99' }]);

    // Should NOT have made an upload request
    const uploadRequest = requests.find((request) => request.url.includes('/upload/drive/v3/files'));
    expect(uploadRequest).toBeUndefined();
  });

  describe('Spreadsheet Discovery and Management', () => {
    it('finds a spreadsheet by appProperties.flacsoTargetId regardless of title changes and inspects query parameters', async () => {
      let requestUrl = '';
      const repository = new GoogleDriveRepository({
        folderId: 'root-folder-1',
        accessTokenOrProvider: 'mock-token',
        fetchImpl: async (input) => {
          requestUrl = String(input);
          return new Response(JSON.stringify({
            files: [
              {
                id: 'sheet-123',
                name: 'Título Cambiado de la Planilla',
                parents: ['folder-cohort-1'],
                webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-123/edit',
                appProperties: {
                  flacsoResource: 'preinscription-spreadsheet',
                  flacsoTargetId: 'offer-target-42',
                  flacsoTargetRevision: 'rev-2',
                  flacsoSheetName: 'Inscripciones',
                },
              },
            ],
          }), { status: 200 });
        },
      });

      const result = await repository.findSpreadsheetByTargetId('root-folder-1', 'offer-target-42');

      expect(result).toEqual({
        targetId: 'offer-target-42',
        spreadsheetId: 'sheet-123',
        sheetName: 'Inscripciones',
        parentFolderId: 'folder-cohort-1',
        url: 'https://docs.google.com/spreadsheets/d/sheet-123/edit',
      });

      // Verify URL query parameters and encoding
      expect(requestUrl).toContain('supportsAllDrives=true');
      expect(requestUrl).toContain('includeItemsFromAllDrives=true');
      const decodedUrl = decodeURIComponent(requestUrl);
      expect(decodedUrl).toContain("mimeType = 'application/vnd.google-apps.spreadsheet'");
      expect(decodedUrl).toContain('trashed = false');
      expect(decodedUrl).toContain("key='flacsoResource' and value='preinscription-spreadsheet'");
      expect(decodedUrl).toContain("key='flacsoTargetId' and value='offer-target-42'");
    });

    it('returns null when no spreadsheet exists for the targetId', async () => {
      const repository = new GoogleDriveRepository({
        folderId: 'root-folder-1',
        accessTokenOrProvider: 'mock-token',
        fetchImpl: async () => new Response(JSON.stringify({ files: [] }), { status: 200 }),
      });

      const result = await repository.findSpreadsheetByTargetId('root-folder-1', 'non-existent-target');
      expect(result).toBeNull();
    });

    it('distinguishes two targets with the same title by querying by targetId', async () => {
      const queries: string[] = [];
      const repository = new GoogleDriveRepository({
        folderId: 'root-folder-1',
        accessTokenOrProvider: 'mock-token',
        fetchImpl: async (input) => {
          const url = String(input);
          queries.push(url);
          if (url.includes('target-a')) {
            return new Response(JSON.stringify({
              files: [{ id: 'sheet-a', name: 'Mismo Título', parents: ['p1'], appProperties: { flacsoResource: 'preinscription-spreadsheet', flacsoTargetId: 'target-a' } }],
            }), { status: 200 });
          }
          return new Response(JSON.stringify({
            files: [{ id: 'sheet-b', name: 'Mismo Título', parents: ['p2'], appProperties: { flacsoResource: 'preinscription-spreadsheet', flacsoTargetId: 'target-b' } }],
          }), { status: 200 });
        },
      });

      const resA = await repository.findSpreadsheetByTargetId('root-folder-1', 'target-a');
      const resB = await repository.findSpreadsheetByTargetId('root-folder-1', 'target-b');

      expect(resA?.spreadsheetId).toBe('sheet-a');
      expect(resB?.spreadsheetId).toBe('sheet-b');
      expect(decodeURIComponent(queries[0]!)).toContain("value='target-a'");
      expect(decodeURIComponent(queries[1]!)).toContain("value='target-b'");
    });

    it('throws an error if multiple spreadsheets exist for the same target (inconsistency)', async () => {
      const repository = new GoogleDriveRepository({
        folderId: 'root-folder-1',
        accessTokenOrProvider: 'mock-token',
        fetchImpl: async () => new Response(JSON.stringify({
          files: [
            { id: 'sheet-1', name: 'Planilla 1', parents: ['p1'], appProperties: { flacsoResource: 'preinscription-spreadsheet', flacsoTargetId: 'duplicate-target' } },
            { id: 'sheet-2', name: 'Planilla 2', parents: ['p2'], appProperties: { flacsoResource: 'preinscription-spreadsheet', flacsoTargetId: 'duplicate-target' } },
          ],
        }), { status: 200 }),
      });

      await expect(repository.findSpreadsheetByTargetId('root-folder-1', 'duplicate-target'))
        .rejects.toThrow(/Inconsistencia en Google Drive: se encontraron 2 planillas/);
    });

    it('ensureTargetFolder creates Ofertas académicas/<oferta>/<cohorte> directly under root and NOT Preinscripciones/Documentación', async () => {
      const createdFolders: Array<{ name: string; parent: string }> = [];
      let folderCounter = 0;
      const repository = new GoogleDriveRepository({
        folderId: 'root-folder-1',
        accessTokenOrProvider: 'mock-token',
        fetchImpl: async (input, init) => {
          const req = new Request(input, init);
          if (req.method === 'GET' && req.url.includes('/drive/v3/files?q=')) {
            // Folders do not exist initially
            return new Response(JSON.stringify({ files: [] }), { status: 200 });
          }
          if (req.method === 'POST') {
            folderCounter += 1;
            const body = JSON.parse(await req.text());
            createdFolders.push({ name: body.name, parent: body.parents[0] });
            return new Response(JSON.stringify({ id: `f-${folderCounter}`, name: body.name }), { status: 200 });
          }
          return new Response(JSON.stringify({}), { status: 200 });
        },
      });

      const academicTarget = {
        id: 'diploma-ed',
        kind: 'academic_offer' as const,
        title: 'Diploma Superior en Educación y Nuevas Tecnologías',
        offerType: 'diploma',
        registrationOpen: true,
        configRevision: 'v1',
        orientations: [],
        mentions: [],
        offer: {
          id: 'offer-ed',
          name: 'Educación y Nuevas Tecnologías',
          type: 'diploma',
        },
        cohort: {
          id: 'cohort-1',
          name: 'Cohorte 2026',
          number: 1,
        },
      };

      const targetFolderId = await repository.ensureTargetFolder('root-folder-1', academicTarget as any);

      expect(targetFolderId).toBe('f-3');
      expect(createdFolders).toEqual([
        { name: 'Ofertas académicas', parent: 'root-folder-1' },
        { name: 'Educación y Nuevas Tecnologías', parent: 'f-1' },
        { name: 'Cohorte 2026', parent: 'f-2' },
      ]);
      expect(createdFolders.some((f) => f.name === 'Preinscripciones' || f.name === 'Documentación')).toBe(false);
    });

    it('moveSpreadsheet calls Drive PATCH with addParents and removeParents, and fails safely on error', async () => {
      let patchUrl = '';
      let patchMethod = '';
      const repository = new GoogleDriveRepository({
        folderId: 'root-folder-1',
        accessTokenOrProvider: 'mock-token',
        fetchImpl: async (input, init) => {
          const req = new Request(input, init);
          patchUrl = req.url;
          patchMethod = req.method;
          return new Response(JSON.stringify({ id: 'sheet-1', parents: ['new-folder'] }), { status: 200 });
        },
      });

      await repository.moveSpreadsheet('sheet-1', 'old-folder', 'new-folder');

      expect(patchMethod).toBe('PATCH');
      expect(patchUrl).toContain('/drive/v3/files/sheet-1');
      expect(patchUrl).toContain('addParents=new-folder');
      expect(patchUrl).toContain('removeParents=old-folder');
      expect(patchUrl).toContain('supportsAllDrives=true');

      // Failure test: permission denied (403)
      const failingRepo = new GoogleDriveRepository({
        folderId: 'root-folder-1',
        accessTokenOrProvider: 'mock-token',
        fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'The user does not have sufficient permissions.' } }), { status: 403 }),
      });

      await expect(failingRepo.moveSpreadsheet('sheet-1', 'old-folder', 'new-folder'))
        .rejects.toThrow(/Google Drive no permitió mover la planilla \(HTTP 403\)/);
    });

    it('moveToTargetFolder moves the spreadsheet only when its parent differs from the target folder', async () => {
      const movedCalls: string[] = [];
      const repository = new GoogleDriveRepository({
        folderId: 'root-folder-1',
        accessTokenOrProvider: 'mock-token',
        fetchImpl: async (input, init) => {
          const req = new Request(input, init);
          const url = req.url;
          if (req.method === 'GET' && url.includes('/drive/v3/files?q=')) {
            // Folders already exist
            return new Response(JSON.stringify({ files: [{ id: 'target-folder-fixed' }] }), { status: 200 });
          }
          if (req.method === 'GET' && url.includes('/drive/v3/files/sheet-to-move')) {
            return new Response(JSON.stringify({
              id: 'sheet-to-move',
              mimeType: 'application/vnd.google-apps.spreadsheet',
              trashed: false,
              parents: ['old-parent-folder'],
              webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-to-move/edit',
              appProperties: { flacsoSheetName: 'Inscripciones' },
            }), { status: 200 });
          }
          if (req.method === 'PATCH' && url.includes('/drive/v3/files/sheet-to-move')) {
            movedCalls.push(url);
            return new Response(JSON.stringify({ id: 'sheet-to-move', parents: ['target-folder-fixed'] }), { status: 200 });
          }
          return new Response(JSON.stringify({}), { status: 200 });
        },
      });

      const academicTarget = {
        id: 'offer-1',
        kind: 'academic_offer' as const,
        title: 'Maestría',
        offerType: 'maestria',
        registrationOpen: true,
        configRevision: 'v1',
        orientations: [],
        mentions: [],
      };

      const discovery = await repository.moveToTargetFolder({
        spreadsheetId: 'sheet-to-move',
        target: academicTarget as any,
        rootFolderId: 'root-folder-1',
      });

      expect(discovery.spreadsheetId).toBe('sheet-to-move');
      expect(discovery.parentFolderId).toBe('target-folder-fixed');
      expect(movedCalls.length).toBe(1);
      expect(movedCalls[0]).toContain('addParents=target-folder-fixed');
      expect(movedCalls[0]).toContain('removeParents=old-parent-folder');
    });
  });

  describe('documentsFolderId and documentsFolderUrl return', () => {
    it('returns documentsFolderId and documentsFolderUrl on storeSubmissionFiles', async () => {
      const repository = new GoogleDriveRepository({
        folderId: 'folder-root',
        accessTokenOrProvider: 'token',
        fetchImpl: async (input, init) => {
          const req = new Request(input, init);
          if (req.url.includes('/files?q=')) {
            return new Response(JSON.stringify({ files: [] }), { status: 200 });
          }
          if (req.method === 'POST' && req.url.includes('/drive/v3/files?fields=')) {
            return new Response(JSON.stringify({ id: 'folder-docs-created' }), { status: 200 });
          }
          return new Response(JSON.stringify({ id: 'drive-file-99', name: 'doc.pdf' }), { status: 200 });
        },
      });

      const result = await repository.storeSubmissionFiles({
        submissionId: 'sub_123',
        target: {
          targetId: 'offer-1',
          kind: 'academic_offer',
          offerName: 'Diploma',
          cohortName: 'Cohorte I',
        },
        files: [{ token: 'tok_1', originalName: 'doc.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }],
      });

      expect(result.files).toHaveLength(1);
      expect(result.documentsFolderId).toBeDefined();
      expect(result.documentsFolderUrl).toContain('https://drive.google.com/drive/folders/');
      expect(result.documentsFolderUrl).toContain(result.documentsFolderId);
    });

    it('resolves documentsFolderId and documentsFolderUrl even when files list is empty', async () => {
      const repository = new GoogleDriveRepository({
        folderId: 'folder-root',
        accessTokenOrProvider: 'token',
        fetchImpl: async (input, init) => {
          const req = new Request(input, init);
          if (req.url.includes('/files?q=')) {
            return new Response(JSON.stringify({ files: [] }), { status: 200 });
          }
          if (req.method === 'POST' && req.url.includes('/drive/v3/files?fields=')) {
            return new Response(JSON.stringify({ id: 'folder-empty-target-docs' }), { status: 200 });
          }
          return new Response(JSON.stringify({}), { status: 200 });
        },
      });

      const result = await repository.storeSubmissionFiles({
        submissionId: 'sub_empty_files',
        target: {
          targetId: 'offer-1',
          kind: 'academic_offer',
          offerName: 'Diploma',
          cohortName: 'Cohorte I',
        },
        files: [],
      });

      expect(result.files).toHaveLength(0);
      expect(result.documentsFolderId).toBe('folder-empty-target-docs');
      expect(result.documentsFolderUrl).toBe('https://drive.google.com/drive/folders/folder-empty-target-docs');
    });
  });
});
