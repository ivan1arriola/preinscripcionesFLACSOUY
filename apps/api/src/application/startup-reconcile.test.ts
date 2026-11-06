import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { createKyselyDb } from '../infrastructure/database/kysely.js';
import { runMigrations } from '../infrastructure/database/migrate.js';
import { PostgresSubmissionRepository } from '../infrastructure/database/postgres-submission-repository.js';
import { PostgresSubmissionRecoveryRepository } from '../infrastructure/database/postgres-submission-recovery-repository.js';
import { PostgresSubmissionProcessingRepository } from '../infrastructure/database/postgres-submission-processing-repository.js';
import { TemporaryFileStorage } from '../infrastructure/files/temporary-file-storage.js';
import { startupReconcile } from './startup-reconcile.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function pdf(content = 'pdf-bytes') {
  return { originalName: 'doc.pdf', mimeType: 'application/pdf', data: Buffer.from(content) };
}

integrationDescribe('startupReconcile (Integración)', () => {
  const db = createKyselyDb(dbUrl);
  const submissions = new PostgresSubmissionRepository(db);
  const recoveryRepo = new PostgresSubmissionRecoveryRepository(db);
  const processingRepo = new PostgresSubmissionProcessingRepository(db);

  let rootDir: string;
  let fileStorage: TemporaryFileStorage;

  beforeAll(async () => {
    await runMigrations(db);
  }, 30000);

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db
      .updateTable('submission_processing')
      .set({ status: 'success' })
      .where('status', 'in', ['pending', 'failed'])
      .execute();
    await db
      .updateTable('submission_recoveries')
      .set({ status: 'resolved' })
      .where('status', 'in', ['pending', 'retrying'])
      .execute();

    rootDir = await mkdtemp(join(tmpdir(), 'flacso-startup-reconcile-'));
    fileStorage = new TemporaryFileStorage({
      rootDir,
      maxBytes: 10 * 1024,
      allowedMimeTypes: ['application/pdf'],
      ttlMs: 30 * 60 * 1000,
    });
  });

  async function createLegacySubmission(opts: {
    status?: 'pending' | 'failed' | 'success';
    files?: Array<{ token: string; originalName: string }>;
  }) {
    const clientId = `sub-leg-${crypto.randomUUID().slice(0, 8)}`;
    const saved = await submissions.saveOrGet({
      clientSubmissionId: clientId,
      targetId: 'davia-c11',
      configRevision: 'v1',
      targetTitle: 'DAVIA',
      targetKind: 'academic_offer',
      values: { email: `${clientId}@example.com` },
      files: opts.files?.map((f) => ({
        token: f.token,
        fieldKey: 'cv',
        originalName: f.originalName,
        mimeType: 'application/pdf',
        size: 100,
      })),
    } as never);

    // Simular que es una fila heredada del código viejo (protocol_version IS NULL)
    await db
      .updateTable('submission_processing')
      .set({
        protocol_version: null,
        status: opts.status ?? 'pending',
        next_attempt_at: null,
      })
      .where('submission_id', '=', saved.id)
      .execute();

    return saved.id;
  }

  it('adopta archivos presentes y encola sheets_reconcile para filas heredadas (protocol_version NULL)', async () => {
    const file = await fileStorage.save('sess-1', 'cv', pdf('contenido legacy'));
    const subId = await createLegacySubmission({
      status: 'pending',
      files: [{ token: file.token, originalName: 'cv.pdf' }],
    });

    const now = new Date('2026-11-06T12:00:00Z');
    const summary = await startupReconcile({
      db,
      fileStorage,
      recoveryRepository: recoveryRepo,
      processingRepository: processingRepo,
      now: () => now,
    });

    expect(summary.reconciledCount).toBeGreaterThanOrEqual(1);

    // Archivo movido a retained/
    expect(await exists(join(rootDir, 'retained', file.token))).toBe(true);
    expect(await exists(join(rootDir, file.token))).toBe(false);

    // No debe haber caso visible de files_missing
    const recoveryCase = await recoveryRepo.findById(subId);
    expect(recoveryCase).toBeNull();

    // submission_processing actualizado con next_attempt_at = now + 200s
    const proc = await db
      .selectFrom('submission_processing')
      .selectAll()
      .where('submission_id', '=', subId)
      .executeTakeFirstOrThrow();

    const expectedNext = new Date(now.getTime() + 200_000);
    expect(new Date(proc.next_attempt_at!).getTime()).toBe(expectedNext.getTime());

    // Tarea sheets_reconcile encolada
    const tasks = await db
      .selectFrom('submission_tasks')
      .selectAll()
      .where('submission_id', '=', subId)
      .where('kind', '=', 'sheets_reconcile')
      .execute();

    expect(tasks).toHaveLength(1);
    expect(new Date(tasks[0]!.run_at).getTime()).toBe(expectedNext.getTime());
  });

  it('adopta archivos vencidos por TTL que aún permanecen en el directorio pendiente', async () => {
    // Storage con TTL 0 para que el archivo nazca con expiresAt en el pasado
    const expiredStorage = new TemporaryFileStorage({
      rootDir,
      maxBytes: 10 * 1024,
      allowedMimeTypes: ['application/pdf'],
      ttlMs: 0,
    });

    const file = await expiredStorage.save('sess-exp', 'cv', pdf('vencido'));
    const subId = await createLegacySubmission({
      status: 'pending',
      files: [{ token: file.token, originalName: 'cv_vencido.pdf' }],
    });

    const now = new Date('2026-11-06T12:00:00Z');
    await startupReconcile({
      db,
      fileStorage: expiredStorage,
      recoveryRepository: recoveryRepo,
      processingRepository: processingRepo,
      now: () => now,
    });

    expect(await exists(join(rootDir, 'retained', file.token))).toBe(true);

    const recoveryCase = await recoveryRepo.findById(subId);
    expect(recoveryCase).toBeNull();
  });

  it('crea un caso visible stage: files_missing cuando los archivos están ausentes en ambos sitios', async () => {
    const absentToken = crypto.randomUUID().replace(/-/g, '');
    const subId = await createLegacySubmission({
      status: 'failed',
      files: [{ token: absentToken, originalName: 'certificado.pdf' }],
    });

    const now = new Date('2026-11-06T12:00:00Z');
    await startupReconcile({
      db,
      fileStorage,
      recoveryRepository: recoveryRepo,
      processingRepository: processingRepo,
      now: () => now,
    });

    const recoveryCase = await recoveryRepo.findById(subId);
    expect(recoveryCase).not.toBeNull();
    expect(recoveryCase?.stage).toBe('files_missing');
    expect(recoveryCase?.safeError).toMatch(/certificado\.pdf/);
  });

  it('es totalmente idempotente: repetir la conciliación no duplica casos ni tareas ni reprograma next_attempt_at', async () => {
    const file = await fileStorage.save('sess-idem', 'cv', pdf('idem'));
    const absentToken = crypto.randomUUID().replace(/-/g, '');
    const subId = await createLegacySubmission({
      status: 'pending',
      files: [
        { token: file.token, originalName: 'cv.pdf' },
        { token: absentToken, originalName: 'titulo.pdf' },
      ],
    });

    const now1 = new Date('2026-11-06T12:00:00Z');
    await startupReconcile({
      db,
      fileStorage,
      recoveryRepository: recoveryRepo,
      processingRepository: processingRepo,
      now: () => now1,
    });

    const procAfterFirst = await db
      .selectFrom('submission_processing')
      .selectAll()
      .where('submission_id', '=', subId)
      .executeTakeFirstOrThrow();

    const tasksAfterFirst = await db
      .selectFrom('submission_tasks')
      .selectAll()
      .where('submission_id', '=', subId)
      .execute();

    const casesAfterFirst = await db
      .selectFrom('submission_recoveries')
      .selectAll()
      .where('submission_id', '=', subId)
      .execute();

    // Segunda ejecución (por ejemplo 5 segundos después en otro reinicio)
    const now2 = new Date('2026-11-06T12:00:05Z');
    await startupReconcile({
      db,
      fileStorage,
      recoveryRepository: recoveryRepo,
      processingRepository: processingRepo,
      now: () => now2,
    });

    const procAfterSecond = await db
      .selectFrom('submission_processing')
      .selectAll()
      .where('submission_id', '=', subId)
      .executeTakeFirstOrThrow();

    const tasksAfterSecond = await db
      .selectFrom('submission_tasks')
      .selectAll()
      .where('submission_id', '=', subId)
      .execute();

    const casesAfterSecond = await db
      .selectFrom('submission_recoveries')
      .selectAll()
      .where('submission_id', '=', subId)
      .execute();

    // next_attempt_at no debe haber cambiado
    expect(new Date(procAfterSecond.next_attempt_at!).getTime()).toBe(new Date(procAfterFirst.next_attempt_at!).getTime());
    // No debe haber duplicación de tareas
    expect(tasksAfterSecond.length).toBe(tasksAfterFirst.length);
    // No debe haber duplicación de casos
    expect(casesAfterSecond.length).toBe(casesAfterFirst.length);
  });

  it('procesa archivos de envíos modernos con caso de recuperación activo sin alterar su protocolo', async () => {
    // Un envío moderno (protocol_version = 1) con caso de recuperación activo (stage: 'drive', status: 'pending')
    const file = await fileStorage.save('sess-mod', 'cv', pdf('moderno'));
    const saved = await submissions.saveOrGet({
      clientSubmissionId: `mod-${crypto.randomUUID().slice(0, 8)}`,
      targetId: 'davia-c11',
      configRevision: 'v1',
      targetTitle: 'DAVIA',
      targetKind: 'academic_offer',
      values: { email: 'modern@example.com' },
      files: [{ token: file.token, fieldKey: 'cv', originalName: 'cv.pdf', mimeType: 'application/pdf', size: 100 }],
    } as never);

    // Creamos un caso activo
    await recoveryRepo.recordFailure({
      submissionId: saved.id,
      targetId: 'davia-c11',
      stage: 'drive',
      safeError: 'Error en Drive',
    });

    const now = new Date('2026-11-06T12:00:00Z');
    await startupReconcile({
      db,
      fileStorage,
      recoveryRepository: recoveryRepo,
      processingRepository: processingRepo,
      now: () => now,
    });

    // El archivo debe haber sido adoptado a retained/
    expect(await exists(join(rootDir, 'retained', file.token))).toBe(true);

    // Al no faltar archivos, el caso activo no se altera a files_missing
    const recoveryCase = await recoveryRepo.findById(saved.id);
    expect(recoveryCase?.stage).toBe('drive');

    // Al NO ser una fila heredada (protocol_version = 1), NO se le encola sheets_reconcile
    const tasks = await db
      .selectFrom('submission_tasks')
      .selectAll()
      .where('submission_id', '=', saved.id)
      .where('kind', '=', 'sheets_reconcile')
      .execute();

    expect(tasks).toHaveLength(0);
  });
});
