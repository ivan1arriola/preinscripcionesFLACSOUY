import { createKyselyDb } from '../database/kysely.js';
import { FilesystemTemporaryStorage } from './filesystem-temporary-storage.js';

export async function runUploadsCleanup(): Promise<number> {
  const baseDir = process.env.UPLOADS_DIR || '/tmp/flacso-uploads';
  const db = createKyselyDb();

  try {
    const storage = new FilesystemTemporaryStorage({ baseDir, db });
    const count = await storage.cleanupExpiredSessions(new Date());
    console.log(`[Uploads Cleanup Worker] Se eliminaron ${count} sesiones expiradas.`);
    return count;
  } finally {
    await db.destroy();
  }
}

if (process.argv[1]?.endsWith('cleanup-worker.ts') || process.argv[1]?.endsWith('cleanup-worker.js')) {
  runUploadsCleanup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Uploads Cleanup Worker Error]:', err);
      process.exit(1);
    });
}
