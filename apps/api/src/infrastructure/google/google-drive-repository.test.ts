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
    expect(requests[0]?.url).toContain('upload/drive/v3/files');
    expect(await requests[0]?.text()).toContain('tmp-token');
  });

  it('fails safely without exposing credentials or pretending success', async () => {
    const repository = new GoogleDriveRepository({ folderId: 'folder-1', accessTokenOrProvider: 'token', fetchImpl: async () => new Response('denied', { status: 403 }) });
    await expect(repository.storeSubmissionFiles({ submissionId: 'sub_1', files: [{ token: 'tmp-token', originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }] })).rejects.toThrow('Google Drive API respondió con error HTTP 403');
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

    expect(requests.filter((request) => request.url.includes('/files?q=')).length).toBe(5);
    const uploadRequest = requests.find((request) => request.url.includes('/upload/drive/v3/files'));
    expect(uploadRequest).toBeDefined();
    const uploadBody = await uploadRequest?.text();
    expect(uploadBody).toContain('apellidos-perez__nombres-ana__cv__sub-1.pdf');
    expect(uploadBody).toContain('flacsoTargetId');
    expect(uploadBody).toContain('flacsoFieldKey');
  });
});
