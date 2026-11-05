import { createKyselyDb } from './infrastructure/database/kysely.js';
import { sweepOnce } from './application/sweep-abandoned-submissions.js';
import { createSweepDependencies, newSweeperId } from './infrastructure/sweep-runtime.js';

/**
 * Ejecuta un barrido manual. `--dry-run` solo lista lo que haría (sin arrendar ni escribir casos).
 * Permite verificar el protocolo en producción con el barrido automático apagado.
 */
const dryRun = process.argv.includes('--dry-run');
const db = createKyselyDb();

try {
  const summary = await sweepOnce(createSweepDependencies(db), { owner: newSweeperId('sweep_once'), now: new Date(), dryRun });
  console.log(dryRun ? '[sweep:once] Vista previa (no se modificó nada).' : '[sweep:once] Barrido ejecutado.');
  console.log(`Envíos abandonados: ${summary.abandoned.length}`);
  for (const item of summary.abandoned) {
    console.log(`  - ${item.submissionId} (destino ${item.targetId})${item.legacy ? ' [anterior al protocolo: resultado incierto]' : ''}`);
  }
  console.log(`Tareas diferidas ejecutadas: ${summary.dueTasks}`);
  if (summary.errors.length > 0) {
    console.error('Errores:');
    for (const error of summary.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  }
} finally {
  await db.destroy();
}
