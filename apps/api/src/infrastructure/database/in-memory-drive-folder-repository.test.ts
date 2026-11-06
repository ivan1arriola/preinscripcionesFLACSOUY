import { describe, expect, it } from 'vitest';
import { InMemoryDriveFolderRepository } from './in-memory-drive-folder-repository.js';

describe('InMemoryDriveFolderRepository', () => {
  it('claims a new folder key with candidate ID and marks created: true', async () => {
    const repo = new InMemoryDriveFolderRepository();
    const result = await repo.claimFolder('root/oferta-1', 'drive-folder-1');

    expect(result).toEqual({ driveFolderId: 'drive-folder-1', created: true });
    const found = await repo.findFolder('root/oferta-1');
    expect(found).not.toBeNull();
    expect(found?.driveFolderId).toBe('drive-folder-1');
    expect(found?.confirmedAt).toBeNull();
  });

  it('keeps the winner ID and returns created: false on conflicting claim with different candidate', async () => {
    const repo = new InMemoryDriveFolderRepository();
    const first = await repo.claimFolder('root/oferta-1', 'drive-folder-winner');
    const second = await repo.claimFolder('root/oferta-1', 'drive-folder-loser');

    expect(first).toEqual({ driveFolderId: 'drive-folder-winner', created: true });
    expect(second).toEqual({ driveFolderId: 'drive-folder-winner', created: false });

    const found = await repo.findFolder('root/oferta-1');
    expect(found?.driveFolderId).toBe('drive-folder-winner');
  });

  it('marks confirmed_at when confirm is called', async () => {
    const repo = new InMemoryDriveFolderRepository();
    await repo.claimFolder('root/oferta-1', 'drive-folder-1');
    await repo.confirm('root/oferta-1');

    const found = await repo.findFolder('root/oferta-1');
    expect(found?.confirmedAt).toBeInstanceOf(Date);
  });
});
