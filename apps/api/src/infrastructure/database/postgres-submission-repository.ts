import crypto from 'node:crypto';
import type {
  SubmissionRepository,
  ValidatedSubmissionRecord,
  SavedSubmissionResult,
} from '../../ports/submission-repository.js';
import type { KyselyDb } from './kysely.js';
import {
  UNIVERSAL_INPUTS,
  SUPPORTED_SPECIFIC_INPUTS,
} from '../../domain/form-definition.js';

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly db: KyselyDb) {}

  async save(record: ValidatedSubmissionRecord): Promise<SavedSubmissionResult> {
    const submissionId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;

    await this.db.transaction().execute(async (trx) => {
      // 1. Ensure minimal target snapshot exists
      await trx
        .insertInto('targets')
        .values({
          id: record.targetId,
          kind: record.targetKind,
          title: record.targetTitle,
          config_revision: record.configRevision,
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            config_revision: record.configRevision,
            title: record.targetTitle,
            updated_at: new Date(),
          })
        )
        .execute();

      // 2. Ensure input definitions exist for submitted keys
      const allKnownInputs = [...UNIVERSAL_INPUTS, ...Object.values(SUPPORTED_SPECIFIC_INPUTS)];

      for (const key of Object.keys(record.values)) {
        const def = allKnownInputs.find((i) => i.key === key);
        if (def) {
          await trx
            .insertInto('input_definitions')
            .values({
              key: def.key,
              label: def.label,
              type: def.type,
              required_by_default: def.required,
              spreadsheet_column: def.spreadsheetColumn ?? def.label,
            })
            .onConflict((oc) => oc.column('key').doNothing())
            .execute();
        }
      }

      // 3. Insert submission
      await trx
        .insertInto('submissions')
        .values({
          id: submissionId,
          target_id: record.targetId,
          config_revision: record.configRevision,
        })
        .execute();

      await trx
        .insertInto('submission_processing')
        .values({
          submission_id: submissionId,
          status: 'pending',
          error_message: null,
          updated_at: new Date(),
        })
        .execute();

      // 4. Insert submission values
      for (const [key, value] of Object.entries(record.values)) {
        if (value !== undefined && value !== null && value.trim().length > 0) {
          await trx
            .insertInto('submission_values')
            .values({
              submission_id: submissionId,
              input_key: key,
              value: value.trim(),
            })
            .execute();
        }
      }

      for (const file of record.files ?? []) {
        await trx
          .insertInto('submission_files')
          .values({
            token: file.token,
            submission_id: submissionId,
            field_key: file.fieldKey,
            original_name: file.originalName,
            mime_type: file.mimeType,
            size: file.size,
            status: 'pending',
            drive_file_id: null,
            error_message: null,
            updated_at: new Date(),
          })
          .onConflict((oc) => oc.column('token').doNothing())
          .execute();
      }
    });

    return { id: submissionId };
  }
}
