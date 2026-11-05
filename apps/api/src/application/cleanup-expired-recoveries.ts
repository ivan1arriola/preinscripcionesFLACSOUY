import type { SubmissionRecoveryRepository } from '../ports/submission-recovery-repository.js';
import type { TemporaryFileStoragePort } from '../ports/file-storage.js';

export interface CleanupExpiredRecoveriesDependencies {
  recoveryRepository: SubmissionRecoveryRepository;
  fileStorage?: TemporaryFileStoragePort;
}

export interface CleanupExpiredRecoveriesResult {
  deletedRecoveries: number;
  removedFiles: number;
}

export async function cleanupExpiredRecoveries(
  dependencies: CleanupExpiredRecoveriesDependencies,
  now: Date = new Date()
): Promise<CleanupExpiredRecoveriesResult> {
  const expiredSubmissionIds = await dependencies.recoveryRepository.deleteExpired(now);
  let removedFiles = 0;
  if (dependencies.fileStorage) {
    removedFiles = await dependencies.fileStorage.cleanup(now.getTime());
    if (dependencies.fileStorage.cleanupExpiredRetained) {
      removedFiles += await dependencies.fileStorage.cleanupExpiredRetained(now.getTime());
    }
  }

  return {
    deletedRecoveries: expiredSubmissionIds.length,
    removedFiles,
  };
}
