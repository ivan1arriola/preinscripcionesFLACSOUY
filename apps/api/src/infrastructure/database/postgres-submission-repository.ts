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
    return this.saveOrGet(record);
  }

  async saveOrGet(record: ValidatedSubmissionRecord): Promise<SavedSubmissionResult> {
    if (record.clientSubmissionId) {
      const existing = await this.db
        .selectFrom('submissions')
        .select('id')
        .where('client_submission_id', '=', record.clientSubmissionId)
        .executeTakeFirst();

      if (existing) {
        return { id: existing.id, existing: true };
      }
    }

    const submissionId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;

    try {
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
        const profileInputs = (record.profileSnapshot as any)?.inputs as Array<{
          key: string;
          label: string;
          type: string;
          required?: boolean;
          spreadsheetColumn?: string;
        }> | undefined;

        const allKnownInputs = [
          ...UNIVERSAL_INPUTS,
          ...Object.values(SUPPORTED_SPECIFIC_INPUTS),
          ...(profileInputs ?? []),
        ];

        for (const key of Object.keys(record.values)) {
          const def = allKnownInputs.find((i) => i.key === key);
          await trx
            .insertInto('input_definitions')
            .values({
              key,
              label: def?.label ?? key,
              type: (def?.type as any) ?? 'text',
              required_by_default: def?.required ?? false,
              spreadsheet_column: def?.spreadsheetColumn ?? def?.label ?? key,
            })
            .onConflict((oc) => oc.column('key').doNothing())
            .execute();
        }

        // 3. Insert submission
        await trx
          .insertInto('submissions')
          .values({
            id: submissionId,
            client_submission_id: record.clientSubmissionId ?? null,
            target_id: record.targetId,
            config_revision: record.configRevision,
            profile_version_id: record.profileVersionId ?? null,
            profile_snapshot: record.profileSnapshot ? JSON.stringify(record.profileSnapshot) : null,
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

      return { id: submissionId, existing: false };
    } catch (error: any) {
      if (record.clientSubmissionId && error?.code === '23505') {
        const existingAfterRace = await this.db
          .selectFrom('submissions')
          .select('id')
          .where('client_submission_id', '=', record.clientSubmissionId)
          .executeTakeFirst();
        if (existingAfterRace) {
          return { id: existingAfterRace.id, existing: true };
        }
      }
      throw error;
    }
  }

  async markProcessing(
    id: string,
    status: 'pending' | 'success' | 'failed' | 'unknown',
    errorMessage?: string
  ): Promise<void> {
    await this.db
      .updateTable('submission_processing')
      .set({
        status,
        error_message: errorMessage ?? null,
        updated_at: new Date(),
      })
      .where('submission_id', '=', id)
      .execute();
  }

  async markFileStored(token: string, driveFileId: string): Promise<void> {
    await this.db
      .updateTable('submission_files')
      .set({
        status: 'success',
        drive_file_id: driveFileId,
        error_message: null,
        updated_at: new Date(),
      })
      .where('token', '=', token)
      .execute();
  }

  async markFileFailed(token: string, errorMessage: string): Promise<void> {
    await this.db
      .updateTable('submission_files')
      .set({
        status: 'failed',
        error_message: errorMessage,
        updated_at: new Date(),
      })
      .where('token', '=', token)
      .execute();
  }
}
