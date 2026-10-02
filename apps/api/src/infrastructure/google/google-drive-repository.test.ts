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
});
