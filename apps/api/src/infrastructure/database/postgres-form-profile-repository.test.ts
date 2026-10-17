import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { PostgresFormProfileRepository } from './postgres-form-profile-repository.js';
import { runMigrations } from './migrate.js';
import { getDefaultProfileDefinition } from '../../domain/form-profiles.js';

const dbUrl = process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
const integrationDescribe = dbUrl ? describe : describe.skip;

integrationDescribe('PostgresFormProfileRepository (Integration with PostgreSQL)', () => {
  const db = createKyselyDb(dbUrl);
  const repository = new PostgresFormProfileRepository(db);

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('retrieves active seeded profile for maestria and seminar', async () => {
    const maestria = await repository.getActive('maestria');
    expect(maestria).not.toBeNull();
    expect(maestria?.type).toBe('maestria');
    expect(maestria?.versionNumber).toBeGreaterThanOrEqual(2);
    expect(maestria?.definition.recommendationLettersCount).toBe(2);
    expect(maestria?.definition.steps.length).toBeGreaterThanOrEqual(5);

    const seminar = await repository.getActive('seminar');
    expect(seminar).not.toBeNull();
    expect(seminar?.type).toBe('seminar');
    expect(seminar?.versionNumber).toBe(1);
    expect(seminar?.definition.steps.length).toBe(4);
    expect(seminar?.definition.fields.map((f) => f.key)).not.toContain('orientacion');
  });

  it('creates a new immutable version, persists audit event, and can activate it', async () => {
    const baseDef = getDefaultProfileDefinition('diplomado');
    const modifiedDef = {
      ...baseDef,
      documents: [
        ...baseDef.documents,
        {
          key: 'extra_doc',
          stepId: 'documentos',
          order: 99,
          label: 'Documento Adicional',
          required: false,
          canDefer: true,
          maxFiles: 1,
        },
      ],
    };

    const newVersion = await repository.createVersion(
      {
        type: 'diplomado',
        definition: modifiedDef,
      },
      'web@flacso.edu.uy',
    );

    expect(newVersion.versionNumber).toBeGreaterThan(1);
    expect(newVersion.definition.documents.some((d) => d.key === 'extra_doc')).toBe(true);

    // Profile is not yet active
    const activeBefore = await repository.getActive('diplomado');
    expect(activeBefore?.versionId).not.toBe(newVersion.id);

    // Activate the new version
    await repository.activateVersion(newVersion.profileId, newVersion.id, 'web@flacso.edu.uy');

    const activeAfter = await repository.getActive('diplomado');
    expect(activeAfter?.versionId).toBe(newVersion.id);
    expect(activeAfter?.versionNumber).toBe(newVersion.versionNumber);

    // Verify audit events exist
    const auditRows = await db
      .selectFrom('form_profile_audit_events')
      .selectAll()
      .where('profile_id', '=', newVersion.profileId)
      .execute();

    expect(auditRows.some((a) => a.action === 'version_created')).toBe(true);
    expect(auditRows.some((a) => a.action === 'version_activated')).toBe(true);
  });

  it('retrieves and updates the authorized admin user', async () => {
    const admin = await repository.getAdminByEmail('web@flacso.edu.uy');
    expect(admin).not.toBeNull();
    expect(admin?.email).toBe('web@flacso.edu.uy');
    expect(admin?.role).toBe('admin');

    const updated = await repository.recordAdminLogin(
      admin!.id,
      'google-sub-123456',
      'Webmaster FLACSO',
      'https://lh3.googleusercontent.com/photo.jpg',
    );

    expect(updated.googleSubject).toBe('google-sub-123456');
    expect(updated.pictureUrl).toBe('https://lh3.googleusercontent.com/photo.jpg');
    expect(updated.lastLoginAt).toBeDefined();

    const bySub = await repository.getAdminByGoogleSubject('google-sub-123456');
    expect(bySub?.email).toBe('web@flacso.edu.uy');
  });
});
