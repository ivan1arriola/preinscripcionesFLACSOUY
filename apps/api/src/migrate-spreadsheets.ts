import { createKyselyDb } from './infrastructure/database/kysely.js';
import { PostgresTargetSpreadsheetRepository } from './infrastructure/database/postgres-target-spreadsheet-repository.js';
import { loadAllGoogleCredentials } from './infrastructure/google/google-credentials.js';
import { HttpGoogleSheetsClient } from './infrastructure/google/sheets-client.js';
import { WordPressAcademicCatalog } from './infrastructure/wordpress/wordpress-academic-catalog.js';
import { WordPressClient } from './infrastructure/wordpress/wordpress-client.js';
import { PostgresWordPressCache } from './infrastructure/wordpress/wordpress-cache.js';
import { FixtureAcademicCatalog } from './infrastructure/fixtures/fixture-academic-catalog.js';
import {
  migrateTargetSpreadsheets,
  type MigrationSubmissionData,
} from './application/migrate-target-spreadsheets.js';

export async function runSpreadsheetMigrationCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = argv;
  const isDryRun = args.includes('--dry-run') || args.includes('-d');
  const targetArg = args.find((a) => a.startsWith('--target='));
  const targetId = targetArg ? targetArg.split('=')[1]?.trim() : undefined;
  const throttleArg = args.find((a) => a.startsWith('--throttle=') || a.startsWith('--delay='));
  const throttleMs = throttleArg ? parseInt(throttleArg.split('=')[1] ?? '1500', 10) : 1500;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Uso: pnpm run migrate:spreadsheets [opciones]
     node apps/api/dist/migrate-spreadsheets.js [opciones]

Opciones:
  --dry-run, -d        Ejecuta la migración en modo simulación sin modificar Google Sheets.
  --target=<targetId>  Migra únicamente la planilla del destino académico indicado.
  --throttle=<ms>      Pausa en milisegundos entre planillas (por defecto: 1500ms).
  --help, -h           Muestra esta ayuda.
`);
    return;
  }

  console.log('='.repeat(70));
  console.log(` FLACSO Uruguay - Migración de Planillas de Preinscripciones`);
  console.log(` Modo: ${isDryRun ? '🔍 SIMULACIÓN (--dry-run)' : '🚀 EN VIVO (aplicando cambios)'}`);
  if (targetId) console.log(` Destino específico: ${targetId}`);
  console.log(` Intervalo de cuota: ${throttleMs}ms`);
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
        new WordPressClient({ baseUrl: process.env.WORDPRESS_URL, catalogToken: process.env.WORDPRESS_CATALOG_TOKEN }),
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
    console.log('Procesando planillas...\n');
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
        throttleMs,
        onProgress: ({ current, total, result }) => {
          const icon = result.status === 'migrated' ? '✅' : result.status === 'skipped' ? '⚠️' : '❌';
          console.log(
            `[${current}/${total}] ${icon} [${result.targetId}] ${result.spreadsheetId} (${result.sheetName}) - ${result.totalRows} filas (${result.matchedDbSubmissions} DB, ${result.manualRowsPreserved} manuales)`
          );
          if (result.error) {
            console.log(`       Detalle: ${result.error}`);
          }
        },
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

// Execute directly if run as main script
const isMain = process.argv[1]?.endsWith('migrate-spreadsheets.js') || process.argv[1]?.endsWith('migrate-spreadsheets.ts');
if (isMain) {
  runSpreadsheetMigrationCli().catch((err) => {
    console.error('Error no controlado:', err);
    process.exit(1);
  });
}
