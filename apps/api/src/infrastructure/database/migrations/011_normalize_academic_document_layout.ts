import { Kysely } from 'kysely';

/**
 * Aligns seeded and previously published profiles with the approved form layout.
 * Existing submissions keep their snapshots; only future form definitions change.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const profiles = await db
    .selectFrom('form_profiles')
    .select(['id', 'type', 'active_version_id'])
    .execute();

  for (const profile of profiles) {
    if (!profile.active_version_id) continue;

    const version = await db
      .selectFrom('form_profile_versions')
      .select(['id', 'version_number', 'definition'])
      .where('id', '=', profile.active_version_id)
      .executeTakeFirst();
    if (!version) continue;

    const definition = typeof version.definition === 'string'
      ? JSON.parse(version.definition)
      : version.definition;
    const fields = Array.isArray(definition.fields) ? definition.fields : [];
    const steps = Array.isArray(definition.steps) ? definition.steps : [];
    const documents = Array.isArray(definition.documents) ? definition.documents : [];
    const nextFields = fields
      .filter((field: { key?: string }) => !['titulo', 'escolaridad', 'institucion'].includes(field.key ?? ''))
      .map((field: { key?: string; stepId?: string }) =>
        field.key === 'orientacion' || field.key === 'mencion'
          ? { ...field, stepId: 'orientacion' }
          : field,
      );
    const hasOrientationStep = steps.some((step: { id?: string }) => step.id === 'orientacion');
    const nextSteps = hasOrientationStep || profile.type === 'seminar'
      ? steps
      : [
          ...steps
            .filter((step: { id?: string }) => step.id !== 'orientacion')
            .map((step: { id?: string; order?: number }) =>
              step.order && step.order >= 4 ? { ...step, order: step.order + 1 } : step,
            ),
          { id: 'orientacion', title: 'Orientación y mención', order: 4 },
        ].sort((a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0));
    const nextDocuments = documents.map((document: { key?: string; stepId?: string }) =>
      document.key === 'titulo' ? { ...document, stepId: 'academico' } : document,
    );

    const changed = JSON.stringify(nextSteps) !== JSON.stringify(steps)
      || JSON.stringify(nextFields) !== JSON.stringify(fields)
      || JSON.stringify(nextDocuments) !== JSON.stringify(documents);
    if (!changed) continue;

    const nextVersionNumber = Number(version.version_number) + 1;
    const nextVersionId = `ver_${profile.type}_academic_layout_v${nextVersionNumber}`;
    const nextDefinition = JSON.stringify({ ...definition, steps: nextSteps, fields: nextFields, documents: nextDocuments });
    await db
      .insertInto('form_profile_versions')
      .values({
        id: nextVersionId,
        profile_id: profile.id,
        version_number: nextVersionNumber,
        definition: nextDefinition,
        created_by: 'system',
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    await db
      .updateTable('form_profiles')
      .set({ active_version_id: nextVersionId })
      .where('id', '=', profile.id)
      .execute();
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Profile versions are immutable so historical submissions remain reproducible.
}
