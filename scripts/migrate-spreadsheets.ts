#!/usr/bin/env tsx
import { createKyselyDb } from '../apps/api/src/infrastructure/database/kysely.js';
import { PostgresTargetSpreadsheetRepository } from '../apps/api/src/infrastructure/database/postgres-target-spreadsheet-repository.js';
import { loadAllGoogleCredentials } from '../apps/api/src/infrastructure/google/google-credentials.js';
import { HttpGoogleSheetsClient } from '../apps/api/src/infrastructure/google/sheets-client.js';
import { WordPressAcademicCatalog } from '../apps/api/src/infrastructure/wordpress/wordpress-academic-catalog.js';
import { WordPressClient } from '../apps/api/src/infrastructure/wordpress/wordpress-client.js';
import { PostgresWordPressCache } from '../apps/api/src/infrastructure/wordpress/wordpress-cache.js';
import { FixtureAcademicCatalog } from '../apps/api/src/infrastructure/fixtures/fixture-academic-catalog.js';
import {
  migrateTargetSpreadsheets,
  type MigrationSubmissionData,
} from '../apps/api/src/application/migrate-target-spreadsheets.js';

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('-d');
  const targetArg = args.find((a) => a.startsWith('--target='));
  const targetId = targetArg ? targetArg.split('=')[1]?.trim() : undefined;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Uso: pnpm run migrate:spreadsheets [opciones]

Opciones:
  --dry-run, -d        Ejecuta la migración en modo simulación sin modificar Google Sheets.
  --target=<targetId>  Migra únicamente la planilla del destino académico indicado.
  --help, -h           Muestra esta ayuda.
`);
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log(` FLACSO Uruguay - Migración de Planillas de Preinscripciones`);
  console.log(` Modo: ${isDryRun ? '🔍 SIMULACIÓN (--dry-run)' : '🚀 EN VIVO (aplicando cambios)'}`);
  if (targetId) console.log(` Destino específico: ${targetId}`);
  console.log('='.repeat(70));

  const db = createKyselyDb();

  const googleCreds = loadAllGoogleCredentials();
  if (!googleCreds.tokenProvider) {
    console.error('❌ Error: No se encontraron credenciales de Google (Service Account o GOOGLE_ACCESS_TOKEN).');
    process.exit(1);
  }

  const sheetsClient = new HttpGoogleSheetsClient({
    accessTokenOrProvider: googleCreds.tokenProvider,
  });

  const catalog = process.env.WORDPRESS_URL
    ? new WordPressAcademicCatalog(
        new WordPressClient({ baseUrl: process.env.WORDPRESS_URL }),
        new PostgresWordPressCache(db)
      )
    : new FixtureAcademicCatalog();

  const targetSpreadsheetRepository = new PostgresTargetSpreadsheetRepository(db);

  const getSubmissionsForTarget = async (tId: string): Promise<MigrationSubmissionData[]> => {
    const submissions = await db
      .selectFrom('submissions')
      .where('target_id', '=', tId)
      .selectAll()
      .orderBy('submitted_at', 'asc')
      .execute();

    const result: MigrationSubmissionData[] = [];

    for (const sub of submissions) {
      const values = await db
        .selectFrom('submission_values')
        .where('submission_id', '=', sub.id)
        .selectAll()
        .execute();

      const valueMap: Record<string, string> = {};
      for (const v of values) {
        valueMap[v.input_key] = v.value;
      }

      const files = await db
        .selectFrom('submission_files')
        .where('submission_id', '=', sub.id)
        .selectAll()
        .execute();

      result.push({
        id: sub.id,
        submittedAt: sub.submitted_at,
        values: valueMap,
        files: files.map((f) => ({
          fieldKey: f.field_key,
          token: f.token,
          driveFileId: f.drive_file_id,
        })),
      });
    }

    return result;
  };

  try {
    const summary = await migrateTargetSpreadsheets(
      {
        targetSpreadsheetRepository,
        catalog,
        sheetsClient,
        getSubmissionsForTarget,
      },
      {
        dryRun: isDryRun,
        targetId,
      }
    );

    console.log('\n📊 Resumen de la migración:');
    console.log('-'.repeat(70));
    console.log(`Planillas procesadas: ${summary.targetsProcessed}`);
    console.log(`Modo simulación: ${summary.dryRun ? 'Sí' : 'No'}`);
    console.log('-'.repeat(70));

    for (const res of summary.results) {
      const icon = res.status === 'migrated' ? '✅' : res.status === 'skipped' ? '⚠️' : '❌';
      console.log(
        `${icon} [${res.targetId}] Planilla: ${res.spreadsheetId} (${res.sheetName})`
      );
      console.log(
        `   Filas: ${res.totalRows} | Base de datos: ${res.matchedDbSubmissions} | Manuales preservadas: ${res.manualRowsPreserved}`
      );
      if (res.error) {
        console.log(`   Detalle: ${res.error}`);
      }
    }
    console.log('='.repeat(70));

    const failures = summary.results.filter((r) => r.status === 'failed');
    if (failures.length > 0) {
      console.error(`⚠️ Finalizado con ${failures.length} error(es).`);
      process.exit(1);
    } else {
      console.log('🎉 Migración completada exitosamente.');
    }
  } catch (err) {
    console.error('❌ Error fatal durante la migración:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('Error no controlado:', err);
  process.exit(1);
});
