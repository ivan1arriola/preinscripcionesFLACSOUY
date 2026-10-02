import { describe, expect, it } from 'vitest';
import { GoogleDriveRepository } from './google-drive-repository.js';

describe('GoogleDriveRepository', () => {
  it('uploads files with an idempotency property and returns Drive identifiers', async () => {
    const requests: Request[] = [];
    let listCalls = 0;
    const repository = new GoogleDriveRepository({
      folderId: 'folder-1',
      accessTokenOrProvider: 'token',
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        const url = input.toString();
        
        if (url.includes('upload/drive/v3/files')) {
          return new Response(JSON.stringify({ id: 'drive-file-1', name: 'cv.pdf' }), { status: 200 });
        }
        if (url.includes('files?q=')) {
          listCalls++;
          return new Response(JSON.stringify({ files: [] }), { status: 200 });
        }
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ id: `new-folder-${listCalls}` }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      },
    });

    const result = await repository.storeSubmissionFiles({
      submissionId: 'sub_1',
      target: {
        targetId: 'target-1',
        kind: 'academic_offer',
        offerName: 'Maestría',
        cohortName: 'Cohorte 1',
      },
      values: { apellido1: 'Pérez', nombre1: 'Ana' },
      files: [{ token: 'tmp-token', fieldKey: 'cv', originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }],
    });

    expect(result).toEqual([{ token: 'tmp-token', driveFileId: 'drive-file-1' }]);
    
    // It should have queried and created: 'Ofertas académicas', 'Maestría', 'Cohorte 1', 'Documentación', 'Preinscripciones'
    const listRequests = requests.filter(r => r.url.includes('files?q='));
    expect(listRequests.length).toBeGreaterThan(0);
    
    const uploadRequest = requests.find(r => r.url.includes('upload/drive/v3/files'));
    expect(uploadRequest).toBeDefined();
    
    const bodyText = await uploadRequest!.text();
    expect(bodyText).toContain('tmp-token');
    expect(bodyText).toContain('flacsoTargetId');
    expect(bodyText).toContain('flacsoDocumentKey');
    // We expect the name to be semantic, not original
    expect(bodyText).toContain('apellidos-perez__nombres-ana__cv__sub_1.pdf');
  });

  it('fails safely without exposing credentials or pretending success', async () => {
    const repository = new GoogleDriveRepository({ folderId: 'folder-1', accessTokenOrProvider: 'token', fetchImpl: async () => new Response('denied', { status: 403 }) });
    await expect(repository.storeSubmissionFiles({ 
      submissionId: 'sub_1', 
      target: { targetId: 't1', kind: 'academic_offer', offerName: 'O', cohortName: 'C' }, 
      values: {}, 
      files: [{ token: 'tmp-token', fieldKey: 'cv', originalName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }] 
    })).rejects.toThrow('Error al buscar carpeta en Google Drive (HTTP 403)');
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
});
