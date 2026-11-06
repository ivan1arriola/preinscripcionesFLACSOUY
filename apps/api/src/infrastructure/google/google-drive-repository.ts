import type { AcademicTarget } from '@flacso/contracts';
import type {
  GoogleDriveFolderInfo,
  GoogleDriveRepositoryPort,
  StoreSubmissionFilesCommand,
  StoredDriveFile,
  StoredDriveFiles,
} from '../../ports/google-drive-repository.js';
import type {
  SpreadsheetDiscovery,
  SpreadsheetDiscoveryPort,
} from '../../ports/spreadsheet-discovery.js';
import type { DriveFolderRepository } from '../../ports/drive-folder-repository.js';
import {
  buildDriveFolderNames,
  buildSemanticDriveFileName,
  buildSubmissionFolderName,
  driveTargetDescriptor,
} from '../../domain/google-drive-naming.js';

export interface DriveFileReservationPort {
  getReservedDriveFileId(token: string): Promise<string | null>;
  reserveDriveFileId(token: string, driveReservedId: string): Promise<string>;
}

export interface GoogleDriveRepositoryOptions {
  folderId?: string;
  folderIdOrProvider?: string | (() => Promise<string>);
  accessTokenOrProvider: string | (() => Promise<string>);
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  folderRepository?: DriveFolderRepository;
  fileRepository?: DriveFileReservationPort;
  submissionRepository?: DriveFileReservationPort;
}

/** Escapa un valor para la sintaxis `q` de Drive (barra invertida y comilla simple). */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class GoogleDriveRepository implements GoogleDriveRepositoryPort, SpreadsheetDiscoveryPort {

  private readonly tokenProvider: () => Promise<string>;
  private readonly folderIdProvider: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly folderRepository?: DriveFolderRepository;
  private readonly fileReservation?: DriveFileReservationPort;

  constructor(options: GoogleDriveRepositoryOptions) {
    this.tokenProvider = typeof options.accessTokenOrProvider === 'function'
      ? options.accessTokenOrProvider
      : async () => options.accessTokenOrProvider as string;

    const rawFolder = options.folderIdOrProvider ?? options.folderId;
    this.folderIdProvider = typeof rawFolder === 'function'
      ? rawFolder
      : async () => {
          if (!rawFolder) throw new Error('La carpeta raíz de Google Drive todavía no está configurada desde el panel administrativo.');
          return rawFolder;
        };

    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.folderRepository = options.folderRepository;
    this.fileReservation = options.fileRepository ?? options.submissionRepository;
  }

  async inspectFolder(folderId: string): Promise<GoogleDriveFolderInfo> {
    const token = await this.tokenProvider();
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`Error de red al consultar la carpeta de Google Drive: ${error instanceof Error ? error.message : 'timeout'}`);
    }
    if (!response.ok) {
      throw new Error(`Google Drive no permitió leer la carpeta configurada (HTTP ${response.status}).`);
    }
    const payload = await response.json() as {
      id?: string;
      name?: string;
      mimeType?: string;
      capabilities?: { canAddChildren?: boolean };
    };
    if (!payload.id || !payload.name || payload.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('El identificador configurado no corresponde a una carpeta de Google Drive.');
    }
    return {
      id: payload.id,
      name: payload.name,
      canAddChildren: payload.capabilities?.canAddChildren === true,
    };
  }

  async storeSubmissionFiles(command: StoreSubmissionFilesCommand): Promise<StoredDriveFiles> {
    const token = await this.tokenProvider();
    const folderId = await this.folderIdProvider();
    let uploadFolderId = folderId;
    let logicalFolderKey = folderId;

    if (command.target) {
      for (const name of buildDriveFolderNames(command.target)) {
        logicalFolderKey = `${logicalFolderKey}/${name}`;
        uploadFolderId = await this.ensureChildFolder(uploadFolderId, name, token, logicalFolderKey);
      }
      logicalFolderKey = `${logicalFolderKey}/Preinscripciones`;
      const preinscripcionesId = await this.ensureChildFolder(uploadFolderId, 'Preinscripciones', token, logicalFolderKey);

      logicalFolderKey = `${logicalFolderKey}/Documentación`;
      const documentacionId = await this.ensureChildFolder(preinscripcionesId, 'Documentación', token, logicalFolderKey);

      if (command.values) {
        const submissionFolderName = buildSubmissionFolderName({
          submissionId: command.submissionId,
          values: command.values,
        });
        logicalFolderKey = `${logicalFolderKey}/${submissionFolderName}`;
        uploadFolderId = await this.ensureChildFolder(documentacionId, submissionFolderName, token, logicalFolderKey);
      } else {
        uploadFolderId = documentacionId;
      }
    }

    const result: StoredDriveFile[] = [];
    const ordinals = new Map<string, number>();

    for (const file of command.files) {
      const ordinal = (ordinals.get(file.fieldKey ?? '') ?? 0) + 1;
      ordinals.set(file.fieldKey ?? '', ordinal);

      const existingFileId = await this.findExistingFile(uploadFolderId, command.submissionId, file.token, token);
      if (existingFileId) {
        result.push({ token: file.token, driveFileId: existingFileId });
        continue;
      }

      let reservedId: string | undefined;
      if (this.fileReservation) {
        const existingReserved = await this.fileReservation.getReservedDriveFileId(file.token);
        if (existingReserved) {
          reservedId = existingReserved;
        } else {
          const generatedId = await this.generateDriveId(token);
          reservedId = await this.fileReservation.reserveDriveFileId(file.token, generatedId);
        }
      }

      const boundary = `flacso-${command.submissionId}-${file.token}`;
      const fileName = command.target && command.values
        ? buildSemanticDriveFileName({
            submissionId: command.submissionId,
            fieldKey: file.fieldKey ?? 'documento',
            originalName: file.originalName,
            mimeType: file.mimeType,
            values: command.values,
            ordinal,
          })
        : file.originalName;

      const metadataPayload: Record<string, any> = {
        name: fileName,
        parents: [uploadFolderId],
        appProperties: {
          flacsoSubmissionId: command.submissionId,
          flacsoFileToken: file.token,
          flacsoTargetId: command.target?.targetId,
          flacsoFieldKey: file.fieldKey,
          flacsoOriginalName: file.originalName,
        },
      };
      if (reservedId) {
        metadataPayload.id = reservedId;
      }

      const metadata = JSON.stringify(metadataPayload);
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
        file.data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await this.fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name&supportsAllDrives=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status === 409 && reservedId) {
        const recoveredId = await this.retrieveExistingFileById(reservedId, token);
        result.push({ token: file.token, driveFileId: recoveredId });
        continue;
      }

      if (!response.ok) {
        throw new Error(`Google Drive API respondió con error HTTP ${response.status}`);
      }
      const payload = await response.json() as { id?: string };
      if (!payload.id) throw new Error('Google Drive no devolvió el identificador del archivo');
      result.push({ token: file.token, driveFileId: payload.id });
    }

    const documentsFolderUrl = `https://drive.google.com/drive/folders/${uploadFolderId}`;
    return {
      files: result,
      documentsFolderId: uploadFolderId,
      documentsFolderUrl,
    };
  }

  private async findExistingFile(
    folderId: string,
    submissionId: string,
    fileToken: string,
    token: string
  ): Promise<string | null> {
    const query = [
      `'${escapeDriveQueryValue(folderId)}' in parents`,
      `appProperties has { key='flacsoSubmissionId' and value='${escapeDriveQueryValue(submissionId)}' }`,
      `appProperties has { key='flacsoFileToken' and value='${escapeDriveQueryValue(fileToken)}' }`,
      'trashed = false',
    ].join(' and ');
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const response = await this.fetchImpl(listUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Google Drive no permitió consultar archivos existentes (HTTP ${response.status}).`);
    }
    const payload = (await response.json()) as { files?: Array<{ id?: string }> };
    return payload.files?.[0]?.id ?? null;
  }

  private async ensureChildFolder(
    parentId: string,
    name: string,
    token: string,
    logicalFolderKey?: string
  ): Promise<string> {
    if (!this.folderRepository) {
      return this.ensureChildFolderLegacy(parentId, name, token);
    }

    const folderKey = logicalFolderKey ?? `${parentId}/${name}`;

    // (a) Fila existente
    const existingRow = await this.folderRepository.findFolder(folderKey);
    if (existingRow) {
      if (existingRow.confirmedAt) {
        return existingRow.driveFolderId;
      }
      // Fila persistida sin confirmed_at tras una caída: la siguiente la completa
      // (d) Crear en Drive solo con el ID ganador tolerando 409 (ya existe)
      await this.createDriveFolderWithId(existingRow.driveFolderId, parentId, name, token);
      // (e) confirm
      await this.folderRepository.confirm(folderKey);
      return existingRow.driveFolderId;
    }

    // (b) Si no hay, adoptar una carpeta ya existente en Drive buscando por nombre y padre,
    // o generar un ID nuevo con files.generateIds
    const existingInDrive = await this.findFolderInDrive(parentId, name, token);
    let candidateId: string;
    if (existingInDrive) {
      candidateId = existingInDrive;
    } else {
      candidateId = await this.generateDriveId(token);
    }

    // (c) claimFolder y usar el ID GANADOR
    const claim = await this.folderRepository.claimFolder(folderKey, candidateId);
    const winnerId = claim.driveFolderId;

    // (d) Crear en Drive solo con el ID ganador tolerando 409 (ya existe)
    await this.createDriveFolderWithId(winnerId, parentId, name, token);

    // (e) confirm
    await this.folderRepository.confirm(folderKey);

    return winnerId;
  }

  private async ensureChildFolderLegacy(parentId: string, name: string, token: string): Promise<string> {
    const existing = await this.findFolderInDrive(parentId, name, token);
    if (existing) return existing;

    const createResponse = await this.fetchImpl('https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!createResponse.ok) {
      throw new Error(`Google Drive no permitió crear la carpeta "${name}" (HTTP ${createResponse.status}).`);
    }
    const created = await createResponse.json() as { id?: string };
    if (!created.id) throw new Error(`Google Drive no devolvió el identificador de la carpeta "${name}".`);
    return created.id;
  }

  private async findFolderInDrive(parentId: string, name: string, token: string): Promise<string | null> {
    const query = [
      `'${escapeDriveQueryValue(parentId)}' in parents`,
      `name = '${escapeDriveQueryValue(name)}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      'trashed = false',
    ].join(' and ');
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const listResponse = await this.fetchImpl(listUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!listResponse.ok) {
      throw new Error(`Google Drive no permitió buscar la carpeta "${name}" (HTTP ${listResponse.status}).`);
    }
    const listPayload = await listResponse.json() as { files?: Array<{ id?: string }> };
    return listPayload.files?.[0]?.id ?? null;
  }

  private async createDriveFolderWithId(
    folderId: string,
    parentId: string,
    name: string,
    token: string
  ): Promise<void> {
    const createResponse = await this.fetchImpl('https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        id: folderId,
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (createResponse.status === 409) {
      return;
    }
    if (!createResponse.ok) {
      throw new Error(`Google Drive no permitió crear la carpeta "${name}" (HTTP ${createResponse.status}).`);
    }
  }

  private async generateDriveId(token: string): Promise<string> {
    const response = await this.fetchImpl('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Google Drive no permitió generar identificadores de archivo (HTTP ${response.status}).`);
    }
    const payload = (await response.json()) as { ids?: string[] };
    const id = payload.ids?.[0];
    if (!id) {
      throw new Error('Google Drive no devolvió un identificador generado.');
    }
    return id;
  }

  private async retrieveExistingFileById(fileId: string, token: string): Promise<string> {
    const response = await this.fetchImpl(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      }
    );
    if (!response.ok) {
      throw new Error(`Google Drive no permitió recuperar el archivo con ID "${fileId}" tras 409 (HTTP ${response.status}).`);
    }
    const payload = (await response.json()) as { id?: string };
    return payload.id ?? fileId;
  }

  async findSpreadsheetByTargetId(_rootFolderId: string, targetId: string): Promise<SpreadsheetDiscovery | null> {
    const token = await this.tokenProvider();
    const query = [
      "mimeType = 'application/vnd.google-apps.spreadsheet'",
      'trashed = false',
      "appProperties has { key='flacsoResource' and value='preinscription-spreadsheet' }",
      `appProperties has { key='flacsoTargetId' and value='${escapeDriveQueryValue(targetId)}' }`,
      "not appProperties has { key='flacsoDetached' and value='true' }",
    ].join(' and ');
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,parents,webViewLink,appProperties)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Google Drive no permitió buscar la planilla del destino "${targetId}" (HTTP ${response.status}).`);
    }
    const payload = (await response.json()) as {
      files?: Array<{
        id?: string;
        name?: string;
        parents?: string[];
        webViewLink?: string;
        appProperties?: Record<string, string>;
      }>;
    };
    const files = payload.files ?? [];
    if (files.length === 0) return null;
    if (files.length > 1) {
      throw new Error(`Inconsistencia en Google Drive: se encontraron ${files.length} planillas para el destino "${targetId}".`);
    }
    const file = files[0]!;
    return {
      targetId,
      spreadsheetId: file.id!,
      sheetName: file.appProperties?.flacsoSheetName || 'Inscripciones',
      parentFolderId: file.parents?.[0] || '',
      url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
    };
  }

  async findByTargetId(rootFolderId: string, targetId: string): Promise<SpreadsheetDiscovery | null> {
    return this.findSpreadsheetByTargetId(rootFolderId, targetId);
  }

  async ensureTargetFolder(rootFolderId: string, target: AcademicTarget): Promise<string> {
    const token = await this.tokenProvider();
    const descriptor = driveTargetDescriptor(target);
    const folderNames = buildDriveFolderNames(descriptor);
    let currentFolderId = rootFolderId;
    let currentLogicalPath = rootFolderId;
    for (const name of folderNames) {
      currentLogicalPath = `${currentLogicalPath}/${name}`;
      currentFolderId = await this.ensureChildFolder(currentFolderId, name, token, currentLogicalPath);
    }
    return currentFolderId;
  }

  async moveSpreadsheet(spreadsheetId: string, fromFolderId: string, toFolderId: string): Promise<void> {
    const token = await this.tokenProvider();
    let url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?addParents=${encodeURIComponent(toFolderId)}&supportsAllDrives=true&fields=id,parents`;
    if (fromFolderId) {
      url += `&removeParents=${encodeURIComponent(fromFolderId)}`;
    }
    const response = await this.fetchImpl(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Google Drive no permitió mover la planilla (HTTP ${response.status}).`);
    }
  }

  async moveToTargetFolder(input: {
    spreadsheetId: string;
    target: AcademicTarget;
    rootFolderId: string;
  }): Promise<SpreadsheetDiscovery> {
    const targetFolderId = await this.ensureTargetFolder(input.rootFolderId, input.target);
    const inspected = await this.inspectSpreadsheet(input.spreadsheetId);
    if (!inspected) {
      throw new Error(`No se encontró la planilla con ID "${input.spreadsheetId}" en Google Drive.`);
    }
    if (inspected.trashed) {
      throw new Error(`La planilla con ID "${input.spreadsheetId}" está en la papelera de Google Drive.`);
    }
    const currentParent = inspected.parents?.[0] || '';
    if (currentParent !== targetFolderId) {
      await this.moveSpreadsheet(input.spreadsheetId, currentParent, targetFolderId);
    }
    return {
      targetId: input.target.id,
      spreadsheetId: input.spreadsheetId,
      sheetName: inspected.appProperties?.flacsoSheetName || 'Inscripciones',
      parentFolderId: targetFolderId,
      url: inspected.webViewLink || `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}/edit`,
    };
  }

  async inspectSpreadsheet(spreadsheetId: string): Promise<{
    id?: string;
    name?: string;
    mimeType?: string;
    trashed?: boolean;
    parents?: string[];
    appProperties?: Record<string, string>;
    webViewLink?: string;
  } | null> {
    const token = await this.tokenProvider();
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=id,name,mimeType,trashed,parents,appProperties,webViewLink&supportsAllDrives=true`;
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Google Drive no permitió consultar la planilla "${spreadsheetId}" (HTTP ${response.status}).`);
    }
    return (await response.json()) as any;
  }

  async setSpreadsheetAppProperties(spreadsheetId: string, properties: Record<string, string>): Promise<void> {
    const token = await this.tokenProvider();
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=id,appProperties&supportsAllDrives=true`;
    const response = await this.fetchImpl(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ appProperties: properties }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Google Drive no permitió actualizar metadatos de la planilla "${spreadsheetId}" (HTTP ${response.status}).`);
    }
  }
}
