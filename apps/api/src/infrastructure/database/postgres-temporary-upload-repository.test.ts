import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { runMigrations } from './migrate.js';
import { PostgresTemporaryUploadRepository } from './postgres-temporary-upload-repository.js';

describe('PostgresTemporaryUploadRepository (Integration)', () => {
  const dbUrl =
    process.env.DATABASE_URL ??
    'postgres://flacso:flacso_password@localhost:5433/flacso_preinscripciones';

  const db = createKyselyDb(dbUrl);
  const repository = new PostgresTemporaryUploadRepository(db, 30 * 60 * 1000); // 30 min TTL

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const uniqueToken = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, '')}`;

  it('persists metadata and retrieves it by token and session', async () => {
    const token = uniqueToken('tok1');
    const record = await repository.create({
      token,
      sessionId: 'session-user-1',
      targetId: 'diploma-davia',
      fieldKey: 'cv',
      originalName: 'curriculum.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    });

    expect(record.token).toBe(token);
    expect(record.sessionId).toBe('session-user-1');
    expect(record.fieldKey).toBe('cv');
    expect(record.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Retrieve with matching session
    const retrieved = await repository.get(token, 'session-user-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.originalName).toBe('curriculum.pdf');
    expect(retrieved?.size).toBe(2048);

    // Retrieve with mismatched session returns null
    const foreign = await repository.get(token, 'other-session');
    expect(foreign).toBeNull();
  });

  it('lists uploads belonging to a session', async () => {
    const sessId = `session-user-${crypto.randomUUID()}`;
    const t1 = uniqueToken('tok2');
    const t2 = uniqueToken('tok3');

    await repository.create({
      token: t1,
      sessionId: sessId,
      targetId: 'diploma-davia',
      fieldKey: 'identidad',
      originalName: 'id1.pdf',
      mimeType: 'application/pdf',
      size: 1000,
    });
    await repository.create({
      token: t2,
      sessionId: sessId,
      targetId: 'diploma-davia',
      fieldKey: 'identidad',
      originalName: 'id2.pdf',
      mimeType: 'application/pdf',
      size: 1500,
    });

    const sessionFiles = await repository.listBySession(sessId);
    expect(sessionFiles).toHaveLength(2);
    expect(sessionFiles.map((f) => f.token)).toContain(t1);
    expect(sessionFiles.map((f) => f.token)).toContain(t2);
  });

  it('touches session and extends expiration on activity', async () => {
    const sessId = `session-touch-${crypto.randomUUID()}`;
    const token = uniqueToken('tok4');

    const record = await repository.create({
      token,
      sessionId: sessId,
      targetId: 'diploma-davia',
      fieldKey: 'cv',
      originalName: 'cv.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    });

    const initialExpiry = record.expiresAt.getTime();
    await new Promise((resolve) => setTimeout(resolve, 50));

    await repository.touch(sessId);
    const updated = await repository.get(token, sessId);
    expect(updated).not.toBeNull();
    expect(updated!.expiresAt.getTime()).toBeGreaterThan(initialExpiry);
  });

  it('removes an owned token and rejects removing a foreign token', async () => {
    const token = uniqueToken('tok5');
    const sessId = `session-remove-${crypto.randomUUID()}`;

    await repository.create({
      token,
      sessionId: sessId,
      targetId: 'diploma-davia',
      fieldKey: 'cv',
      originalName: 'cv.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    });

    // Foreign removal should fail (return false)
    const foreignRemoved = await repository.remove(token, 'wrong-session');
    expect(foreignRemoved).toBe(false);

    // Owner removal succeeds
    const ownerRemoved = await repository.remove(token, sessId);
    expect(ownerRemoved).toBe(true);

    const check = await repository.get(token);
    expect(check).toBeNull();
  });

  it('lists expired records before a timestamp and deletes metadata', async () => {
    const token = uniqueToken('tok-exp');
    const pastDate = new Date(Date.now() - 1000);
    await repository.create({
      token,
      sessionId: 'session-expired',
      targetId: 'diploma-davia',
      fieldKey: 'cv',
      originalName: 'cv.pdf',
      mimeType: 'application/pdf',
      size: 500,
      expiresAt: pastDate,
    });

    const expired = await repository.listExpired(new Date());
    expect(expired.some((f) => f.token === token)).toBe(true);

    await repository.deleteMetadata(token);
    const afterDelete = await repository.get(token);
    expect(afterDelete).toBeNull();
  });
});
