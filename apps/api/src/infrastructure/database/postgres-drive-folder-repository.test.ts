import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { runMigrations } from './migrate.js';
import { PostgresDriveFolderRepository } from './postgres-drive-folder-repository.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

integrationDescribe('PostgresDriveFolderRepository (Integration with PostgreSQL)', () => {
  const db = createKyselyDb(dbUrl);
  const repo = new PostgresDriveFolderRepository(db);

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom('drive_folders').execute();
  });

  it('claims a new folder key and returns created: true with the candidate ID', async () => {
    const key = `root/oferta-${Date.now()}`;
    const result = await repo.claimFolder(key, 'candidate-1');

    expect(result).toEqual({ driveFolderId: 'candidate-1', created: true });

    const found = await repo.findFolder(key);
    expect(found).not.toBeNull();
    expect(found?.driveFolderId).toBe('candidate-1');
    expect(found?.confirmedAt).toBeNull();
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it('enforces a single winner when two candidates claim the same folder key concurrently', async () => {
    const key = `root/oferta-concurrente-${Date.now()}`;
    const [res1, res2] = await Promise.all([
      repo.claimFolder(key, 'candidate-A'),
      repo.claimFolder(key, 'candidate-B'),
    ]);

    // Exactly one was created
    const createdCount = [res1.created, res2.created].filter(Boolean).length;
    expect(createdCount).toBe(1);

    // Both observe the SAME winning driveFolderId
    expect(res1.driveFolderId).toBe(res2.driveFolderId);
    expect(['candidate-A', 'candidate-B']).toContain(res1.driveFolderId);

    // The database row has the winner ID
    const found = await repo.findFolder(key);
    expect(found?.driveFolderId).toBe(res1.driveFolderId);
  });

  it('returns the existing winner on subsequent sequential claim with a different candidate', async () => {
    const key = `root/oferta-seq-${Date.now()}`;
    const first = await repo.claimFolder(key, 'winner-id');
    const second = await repo.claimFolder(key, 'loser-id');

    expect(first).toEqual({ driveFolderId: 'winner-id', created: true });
    expect(second).toEqual({ driveFolderId: 'winner-id', created: false });

    const found = await repo.findFolder(key);
    expect(found?.driveFolderId).toBe('winner-id');
  });

  it('marks confirmed_at when confirm is called', async () => {
    const key = `root/oferta-confirm-${Date.now()}`;
    await repo.claimFolder(key, 'candidate-1');
    await repo.confirm(key);

    const found = await repo.findFolder(key);
    expect(found?.confirmedAt).toBeInstanceOf(Date);
  });
});
