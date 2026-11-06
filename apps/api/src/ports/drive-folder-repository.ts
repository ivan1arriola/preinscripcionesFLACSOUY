export interface DriveFolderRecord {
  folderKey: string;
  driveFolderId: string;
  createdAt?: Date;
  confirmedAt?: Date | null;
}

export interface ClaimFolderResult {
  driveFolderId: string;
  created: boolean;
}

/**
 * Puerto para la gestión persistente de carpetas lógicas de Drive (P2).
 * Permite que múltiples preinscripciones concurrentes converjan en un único ID de carpeta
 * mediante un INSERT ... ON CONFLICT (folder_key) DO NOTHING con relectura del ganador.
 */
export interface DriveFolderRepository {
  findFolder(folderKey: string): Promise<DriveFolderRecord | null>;
  claimFolder(folderKey: string, candidateId: string): Promise<ClaimFolderResult>;
  confirm(folderKey: string): Promise<void>;
}
