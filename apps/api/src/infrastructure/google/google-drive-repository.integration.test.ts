import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createKyselyDb } from '../database/kysely.js';
import { runMigrations } from '../database/migrate.js';
import { PostgresDriveFolderRepository } from '../database/postgres-drive-folder-repository.js';
import { PostgresSubmissionRepository } from '../database/postgres-submission-repository.js';
import { GoogleDriveRepository } from './google-drive-repository.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

integrationDescribe('GoogleDriveRepository (Integration with PostgreSQL drive_folders)', () => {
  const db = createKyselyDb(dbUrl);
  const folderRepo = new PostgresDriveFolderRepository(db);
  const submissionRepo = new PostgresSubmissionRepository(db);

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom('drive_folders').execute();
  });

  it('dos preinscripciones distintas a una oferta nueva en paralelo terminan con una sola jerarquía persistida en Postgres', async () => {
    let generatedIdSeq = 0;
    const createdFoldersInDrive = new Map<string, any>();

    const makeRepo = () =>
      new GoogleDriveRepository({
        folderId: 'root-pg-1',
        accessTokenOrProvider: 'mock-token',
        folderRepository: folderRepo,
        submissionRepository: submissionRepo,
        fetchImpl: async (input, init) => {
          const req = new Request(input, init);

          if (req.url.includes('/files/generateIds')) {
            generatedIdSeq++;
            return new Response(JSON.stringify({ ids: [`drive-pg-id-${generatedIdSeq}`] }), { status: 200 });
          }

          if (req.url.includes('/files?q=') && !req.url.includes('flacsoSubmissionId')) {
            return new Response(JSON.stringify({ files: [] }), { status: 200 });
          }

          if (req.method === 'POST' && req.url.includes('/drive/v3/files?fields=')) {
            const body = JSON.parse(await req.clone().text());
            if (createdFoldersInDrive.has(body.id)) {
              return new Response(JSON.stringify({ error: { code: 409, message: 'Conflict' } }), { status: 409 });
            }
            createdFoldersInDrive.set(body.id, body);
            return new Response(JSON.stringify({ id: body.id, name: body.name }), { status: 200 });
          }

          return new Response(JSON.stringify({ id: `file-${Date.now()}` }), { status: 200 });
        },
      });

    const repo1 = makeRepo();
    const repo2 = makeRepo();

    const target = {
      targetId: 'diploma-politicas-2026',
      kind: 'academic_offer' as const,
      offerName: 'Diploma en Políticas Públicas',
      cohortName: 'Cohorte 2026',
    };

    const [res1, res2] = await Promise.all([
      repo1.storeSubmissionFiles({
        submissionId: 'sub-pg-A',
        target,
        values: { apellido1: 'Arriola', nombre1: 'Iván' },
        files: [],
      }),
      repo2.storeSubmissionFiles({
        submissionId: 'sub-pg-B',
        target,
        values: { apellido1: 'Silva', nombre1: 'María' },
        files: [],
      }),
    ]);

    // Check PostgreSQL database:
    // Shared logical folders must be unique in drive_folders table:
    const docKey = 'root-pg-1/Ofertas académicas/Diploma en Políticas Públicas/Cohorte 2026/Preinscripciones/Documentación';
    const docFolderRow = await folderRepo.findFolder(docKey);
    expect(docFolderRow).not.toBeNull();
    expect(docFolderRow?.confirmedAt).toBeInstanceOf(Date);

    // Verify both applicant folders are children of the single Documentación folder
    const applicantFolderA = createdFoldersInDrive.get(res1.documentsFolderId);
    const applicantFolderB = createdFoldersInDrive.get(res2.documentsFolderId);

    expect(applicantFolderA.parents).toEqual([docFolderRow?.driveFolderId]);
    expect(applicantFolderB.parents).toEqual([docFolderRow?.driveFolderId]);
    expect(res1.documentsFolderId).not.toBe(res2.documentsFolderId);

    // Count how many total drive_folders were persisted
    const allDbFolders = await db.selectFrom('drive_folders').selectAll().execute();
    // 5 shared levels:
    // 1. root-pg-1/Ofertas académicas
    // 2. root-pg-1/Ofertas académicas/Diploma en Políticas Públicas
    // 3. root-pg-1/Ofertas académicas/Diploma en Políticas Públicas/Cohorte 2026
    // 4. root-pg-1/Ofertas académicas/Diploma en Políticas Públicas/Cohorte 2026/Preinscripciones
    // 5. root-pg-1/Ofertas académicas/Diploma en Políticas Públicas/Cohorte 2026/Preinscripciones/Documentación
    // + 2 individual applicant folders = 7 rows total
    expect(allDbFolders).toHaveLength(7);

    // All must be confirmed
    for (const row of allDbFolders) {
      expect(row.confirmed_at).not.toBeNull();
    }
  });
});
