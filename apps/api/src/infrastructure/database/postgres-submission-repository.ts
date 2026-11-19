import crypto from 'node:crypto';
import { sql } from 'kysely';
import type {
  SubmissionRepository,
  ValidatedSubmissionRecord,
  SavedSubmissionResult,
} from '../../ports/submission-repository.js';
import type { KyselyDb } from './kysely.js';

/** Duración del lease del procesador; se renueva mientras el envío sigue trabajando. */
export const SUBMISSION_LEASE_TTL_MS = 60_000;

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly db: KyselyDb) {}

  async save(record: ValidatedSubmissionRecord): Promise<SavedSubmissionResult> {
    return this.saveOrGet(record);
  }

  async findByClientSubmissionId(clientSubmissionId: string): Promise<{ id: string } | null> {
    const existing = await this.db
      .selectFrom('submissions')
      .select('id')
      .where('client_submission_id', '=', clientSubmissionId)
      .executeTakeFirst();
    return existing ? { id: existing.id } : null;
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
    // El lease nace con la fila, dentro de la misma transacción: nunca hay una preinscripción guardada sin dueño.
    const leaseOwner = `req_${crypto.randomUUID().replace(/-/g, '')}`;

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

        const allKnownInputs = profileInputs ?? [];

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
            catalog_validation: record.catalogValidation ?? 'live',
            utm: record.utm && Object.keys(record.utm).length > 0 ? JSON.stringify(record.utm) : null,
          })
          .execute();

        if (record.mauticContact) {
          await trx
            .insertInto('mautic_contact_sync')
            .values({
              id: `mcs_${crypto.randomUUID().replace(/-/g, '')}`,
              submission_id: submissionId,
              payload_json: JSON.stringify(record.mauticContact),
              status: 'pending',
              attempt_count: 0,
              available_at: new Date(),
              locked_until: null,
              locked_by: null,
              last_error: null,
              mautic_contact_id: null,
              synced_at: null,
            })
            .execute();
        }

        if (record.mauticEnrollment) {
          await trx
            .insertInto('mautic_enrollment_notify')
            .values({
              id: crypto.randomUUID(),
              submission_id: submissionId,
              payload_json: JSON.stringify(record.mauticEnrollment),
              status: 'pending',
              attempt_count: 0,
              available_at: new Date(),
              locked_until: null,
              locked_by: null,
              last_error: null,
              notified_at: null,
            })
            .execute();
        }

        await trx
          .insertInto('submission_processing')
          .values({
            submission_id: submissionId,
            status: 'pending',
            error_message: null,
            updated_at: new Date(),
            lease_owner: leaseOwner,
            lease_expires_at: new Date(Date.now() + SUBMISSION_LEASE_TTL_MS),
            protocol_version: 1,
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

      return { id: submissionId, existing: false, leaseOwner };
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

  async markSuccessWithNotificationIntent(id: string, links: { targetId: string; spreadsheetUrl: string; documentsFolderUrl: string }): Promise<string> {
    const now = new Date();
    return this.db.transaction().execute(async (trx) => {
      const processing = await trx.updateTable('submission_processing')
        .set({ status: 'success', error_message: null, updated_at: now })
        .where('submission_id', '=', id).returning('submission_id').executeTakeFirstOrThrow();
      const row = await trx.insertInto('submission_recoveries').values({
        id: `rec_${crypto.randomUUID().replace(/-/g, '')}`, submission_id: processing.submission_id,
        target_id: links.targetId, stage: 'notifications', status: 'pending',
        safe_error: 'Notificaciones pendientes de encolado.', spreadsheet_url: links.spreadsheetUrl,
        documents_folder_url: links.documentsFolderUrl, attempt_count: 0, first_failed_at: now,
        last_attempt_at: now, retention_expires_at: new Date(now.getTime() + 7 * 86400000),
        created_at: now, updated_at: now,
      }).onConflict((oc) => oc.column('submission_id').doUpdateSet({
        stage: 'notifications', status: 'pending', safe_error: 'Notificaciones pendientes de encolado.',
        spreadsheet_url: links.spreadsheetUrl, documents_folder_url: links.documentsFolderUrl,
        locked_until: null, locked_by: null, updated_at: now,
      })).returning('id').executeTakeFirstOrThrow();
      return row.id;
    });
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

  async getReservedDriveFileId(token: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('submission_files')
      .select('drive_reserved_id')
      .where('token', '=', token)
      .executeTakeFirst();
    return row?.drive_reserved_id ?? null;
  }

  async reserveDriveFileId(token: string, driveReservedId: string): Promise<string> {
    const updated = await this.db
      .updateTable('submission_files')
      .set({ drive_reserved_id: driveReservedId, updated_at: new Date() })
      .where('token', '=', token)
      .where('drive_reserved_id', 'is', null)
      .returning('drive_reserved_id')
      .executeTakeFirst();

    if (updated?.drive_reserved_id) {
      return updated.drive_reserved_id;
    }

    const existing = await this.db
      .selectFrom('submission_files')
      .select('drive_reserved_id')
      .where('token', '=', token)
      .executeTakeFirst();

    return existing?.drive_reserved_id ?? driveReservedId;
  }

  async recordProcessingFailure(
    id: string,
    stage: 'drive' | 'sheets' | 'notifications' | 'unknown',
    safeError: string,
    retentionDays: number = 7
  ): Promise<void> {
    const now = new Date();
    const retentionExpiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('submission_processing')
        .set({
          status: 'failed',
          error_message: safeError,
          updated_at: now,
        })
        .where('submission_id', '=', id)
        .execute();

      const sub = await trx
        .selectFrom('submissions')
        .select('target_id')
        .where('id', '=', id)
        .executeTakeFirst();

      if (!sub) return;

      await trx
        .insertInto('submission_recoveries')
        .values({
          id: `rec_${crypto.randomUUID().replace(/-/g, '')}`,
          submission_id: id,
          target_id: sub.target_id,
          stage,
          status: 'pending',
          safe_error: safeError,
          attempt_count: 1,
          first_failed_at: now,
          last_attempt_at: now,
          retention_expires_at: retentionExpiresAt,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column('submission_id').doUpdateSet({
            stage,
            safe_error: safeError,
            attempt_count: sql`submission_recoveries.attempt_count + 1`,
            last_attempt_at: now,
            updated_at: now,
          })
        )
        .execute();
    });
  }
}
