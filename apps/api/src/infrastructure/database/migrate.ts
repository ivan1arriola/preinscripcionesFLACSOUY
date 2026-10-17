import { createKyselyDb } from './kysely.js';
import * as initialSchema from './migrations/001_initial_schema.js';
import * as wordpressCacheSchema from './migrations/002_wordpress_cache.js';
import * as spreadsheetOperationsSchema from './migrations/003_spreadsheet_operations.js';
import * as completeFormSubmissionsSchema from './migrations/004_complete_form_submissions.js';
import * as submissionFilesSchema from './migrations/005_submission_files.js';
import * as formProfilesAndAdminAuthSchema from './migrations/006_form_profiles_and_admin_auth.js';
import * as systemSettingsSchema from './migrations/007_system_settings.js';
import * as adminSessionsSchema from './migrations/008_admin_sessions.js';
import * as temporaryUploadsSchema from './migrations/009_temporary_uploads.js';
import * as submissionIdempotencySchema from './migrations/010_submission_idempotency.js';
import * as academicDocumentLayoutSchema from './migrations/011_normalize_academic_document_layout.js';
import * as targetSpreadsheetsReconciliationSchema from './migrations/012_target_spreadsheets_reconciliation.js';
import * as emailNotificationsSchema from './migrations/013_email_notifications.js';
import * as smtpEmailSettingsSchema from './migrations/014_smtp_email_settings.js';
import * as submissionRecoverySchema from './migrations/015_submission_recovery.js';
import * as telegramRecoveryAlertsSchema from './migrations/016_telegram_recovery_alerts.js';
import * as telegramEventTypesSchema from './migrations/017_telegram_event_types.js';
import * as registrationEventOutboxSchema from './migrations/018_registration_event_outbox.js';

export async function runMigrations(db = createKyselyDb()): Promise<void> {
  console.log('Running migrations...');
  await initialSchema.up(db);
  await wordpressCacheSchema.up(db);
  await spreadsheetOperationsSchema.up(db);
  await completeFormSubmissionsSchema.up(db);
  await submissionFilesSchema.up(db);
  await formProfilesAndAdminAuthSchema.up(db);
  await systemSettingsSchema.up(db);
  await adminSessionsSchema.up(db);
  await temporaryUploadsSchema.up(db);
  await submissionIdempotencySchema.up(db);
  await academicDocumentLayoutSchema.up(db);
  await targetSpreadsheetsReconciliationSchema.up(db);
  await emailNotificationsSchema.up(db);
  await smtpEmailSettingsSchema.up(db);
  await submissionRecoverySchema.up(db);
  await telegramRecoveryAlertsSchema.up(db);
  await telegramEventTypesSchema.up(db);
  await registrationEventOutboxSchema.up(db);
  console.log('Migrations complete.');
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  const db = createKyselyDb();
  runMigrations(db)
    .then(async () => {
      await db.destroy();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await db.destroy();
      process.exit(1);
    });
}
