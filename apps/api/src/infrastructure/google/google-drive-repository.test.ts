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

    expect(result).toEqual([{ token: 'tmp-token', driveFileId: 'drive-file-1' }]);
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

    await repository.storeSubmissionFiles({
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
    expect(folderCreationRequests.length).toBe(5);

    // Verify folder 4 (Preinscripciones) has parent folder-3 (Cohorte VII)
    const preinscripcionesBody = JSON.parse(await folderCreationRequests[3]!.clone().text());
    expect(preinscripcionesBody.name).toBe('Preinscripciones');
    expect(preinscripcionesBody.parents).toEqual(['folder-3']);

    // Verify folder 5 (Documentación) has parent folder-4 (Preinscripciones)
    const documentacionBody = JSON.parse(await folderCreationRequests[4]!.clone().text());
    expect(documentacionBody.name).toBe('Documentación');
    expect(documentacionBody.parents).toEqual(['folder-4']);

    const uploadRequest = requests.find((request) => request.url.includes('/upload/drive/v3/files'));
    expect(uploadRequest).toBeDefined();
    const uploadBody = await uploadRequest?.text();
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
    expect(result).toEqual([{ token: 'tmp-token', driveFileId: 'existing-drive-file-99' }]);

    // Should NOT have made an upload request
    const uploadRequest = requests.find((request) => request.url.includes('/upload/drive/v3/files'));
    expect(uploadRequest).toBeUndefined();
  });
});
