import type { AcademicCatalog } from '../ports/academic-catalog.js';
import type { SubmissionRepository } from '../ports/submission-repository.js';
import type { SpreadsheetRepository } from '../ports/spreadsheet-repository.js';
import type { DriveRepository } from '../ports/drive-repository.js';
import type { TemporaryFileStorage } from '../ports/temporary-file-storage.js';
import { composeForm } from '../domain/form-composition.js';
import { validateSubmission } from '../domain/form-validation.js';

export interface SubmitWithDocumentsParams {
  targetId: string;
  configRevision: string;
  values: Record<string, string>;
  sessionId?: string;
  spreadsheetId?: string;
  catalog: AcademicCatalog;
  submissionRepo: SubmissionRepository;
  spreadsheetRepo?: SpreadsheetRepository;
  driveRepo?: DriveRepository;
  tempStorage?: TemporaryFileStorage;
}

export interface SubmitWithDocumentsResult {
  submissionId: string;
  documentLinks: string[];
}

export class SubmissionApplicationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SubmissionApplicationError';
  }
}

export async function submitWithDocuments(
  params: SubmitWithDocumentsParams
): Promise<SubmitWithDocumentsResult> {
  const {
    targetId,
    configRevision,
    values,
    sessionId,
    spreadsheetId,
    catalog,
    submissionRepo,
    spreadsheetRepo,
    driveRepo,
    tempStorage,
  } = params;

  // 1. Revalidate target
  const target = await catalog.revalidateTarget(targetId);
  if (!target) {
    throw new SubmissionApplicationError('Destino no encontrado', 'TARGET_NOT_FOUND');
  }

  if (!target.registrationOpen) {
    throw new SubmissionApplicationError('La preinscripción para este destino está cerrada', 'REGISTRATION_CLOSED');
  }

  const composition = composeForm(target);
  if (!composition.ok) {
    throw new SubmissionApplicationError(
      'El destino académico contiene configuraciones incompatibles',
      'INCOMPATIBLE_TARGET',
      composition.error.issues
    );
  }

  const formDef = composition.value;
  const validation = validateSubmission(formDef, values, configRevision);
  if (!validation.valid) {
    throw new SubmissionApplicationError(
      'Errores de validación en el formulario',
      'VALIDATION_FAILED',
      validation.fieldErrors
    );
  }

  // 2. Upload documents to Drive if session exists
  const documentLinks: string[] = [];
  if (sessionId && driveRepo && tempStorage) {
    const session = await tempStorage.getSession(sessionId);
    if (session && session.files.length > 0) {
      const folders = await driveRepo.resolveTargetFolders(target.id, target.title);

      for (const fileInfo of session.files) {
        const fileData = await tempStorage.getFile(sessionId, fileInfo.id);
        if (fileData) {
          const driveFile = await driveRepo.uploadDocument(
            folders.documentsFolderId,
            fileInfo.originalName,
            fileInfo.mimeType,
            fileData.buffer
          );
          documentLinks.push(driveFile.webViewLink);
        }
      }
    }
  }

  // 3. Write row to Google Sheets by column names
  if (spreadsheetRepo && spreadsheetId) {
    const valuesByColumn: Record<string, string> = {
      'Marca temporal': new Date().toISOString(),
    };
    const requiredColumns: string[] = [];

    for (const input of formDef.inputs) {
      const colName = input.spreadsheetColumn || input.label;
      valuesByColumn[colName] = values[input.key] ?? '';
      if (input.required) {
        requiredColumns.push(colName);
      }
    }

    if (documentLinks.length > 0) {
      valuesByColumn['Documentación'] = documentLinks.join('\n');
    }

    await spreadsheetRepo.appendByHeaders(
      spreadsheetId,
      valuesByColumn,
      requiredColumns
    );
  }

  // 4. Save normalized submission to Postgres
  const saved = await submissionRepo.save({
    targetId: target.id,
    targetTitle: target.title,
    targetKind: target.kind,
    configRevision: target.configRevision,
    values,
  });

  // 5. Clean up temporary files session after successful submission
  if (sessionId && tempStorage) {
    try {
      await tempStorage.deleteSession(sessionId);
    } catch {
      // Non-blocking cleanup failure
    }
  }

  return {
    submissionId: saved.id,
    documentLinks,
  };
}
