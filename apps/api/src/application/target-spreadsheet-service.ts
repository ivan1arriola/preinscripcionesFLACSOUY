import type { AcademicTarget } from '@flacso/contracts';
import { SUPPORTED_SPECIFIC_INPUTS, UNIVERSAL_INPUTS } from '../domain/form-definition.js';
import { isSupportedOfferType } from '../domain/form-profiles.js';
import type {
  TargetSpreadsheetConfiguration,
  TargetSpreadsheetRepository,
} from '../ports/target-spreadsheet-repository.js';
import type { SpreadsheetDiscoveryPort } from '../ports/spreadsheet-discovery.js';

export interface SpreadsheetProvisioningCommand {
  targetId?: string;
  configRevision?: string;
  title: string;
  folderId: string;
  sheetName: string;
  headers: string[];
}

export interface SpreadsheetProvisioned {
  spreadsheetId: string;
  sheetName: string;
  url?: string;
}

export interface SpreadsheetProvisioner {
  create(command: SpreadsheetProvisioningCommand): Promise<SpreadsheetProvisioned>;
}

export interface TargetReconciliationItem {
  targetId: string;
  status: 'reconciled' | 'created' | 'unchanged' | 'blocked' | 'detached';
  spreadsheetId?: string;
  code?: string;
  message?: string;
}

export interface TargetsReconciliationResult {
  status: 'completed' | 'blocked';
  targets: TargetReconciliationItem[];
}

export function buildSpreadsheetHeaders(): string[] {
  const headers = [
    ...UNIVERSAL_INPUTS,
    ...Object.values(SUPPORTED_SPECIFIC_INPUTS),
  ].map((input) => input.spreadsheetColumn ?? input.label);
  return [...new Set(headers)];
}

export function canProvisionTargetSpreadsheet(target: AcademicTarget): boolean {
  const offerType = target.kind === 'seminar' ? 'seminar' : target.offer?.type || target.offerType || '';
  return target.kind === 'seminar' || isSupportedOfferType(offerType);
}

export class TargetSpreadsheetService {
  private readonly locks = new Map<string, Promise<TargetSpreadsheetConfiguration>>();
  private readonly discoveryPort?: SpreadsheetDiscoveryPort;
  private readonly sheetName: string;

  constructor(
    private readonly repository: TargetSpreadsheetRepository,
    private readonly provisioner: SpreadsheetProvisioner,
    private readonly driveRootProvider: () => Promise<string | null>,
    discoveryPortOrSheetName?: SpreadsheetDiscoveryPort | string,
    discoveryPort?: SpreadsheetDiscoveryPort,
  ) {
    if (typeof discoveryPortOrSheetName === 'string') {
      this.sheetName = discoveryPortOrSheetName;
      this.discoveryPort = discoveryPort;
    } else {
      this.sheetName = 'Inscripciones';
      this.discoveryPort = discoveryPortOrSheetName;
    }
  }

  async ensureForTarget(target: AcademicTarget): Promise<TargetSpreadsheetConfiguration> {
    const currentLock = this.locks.get(target.id);
    if (currentLock) return currentLock;

    const task = this.executeEnsureForTarget(target);
    this.locks.set(target.id, task);
    try {
      return await task;
    } finally {
      this.locks.delete(target.id);
    }
  }

  async ensureForTargets(targets: AcademicTarget[]): Promise<TargetSpreadsheetConfiguration[]> {
    const configurations: TargetSpreadsheetConfiguration[] = [];
    for (const target of targets) {
      if (!canProvisionTargetSpreadsheet(target)) continue;
      configurations.push(await this.ensureForTarget(target));
    }
    return configurations;
  }

  async unlinkForTarget(targetId: string): Promise<TargetSpreadsheetConfiguration> {
    const current = await this.repository.get(targetId);
    if (!current) throw Object.assign(new Error('La oferta todavía no tiene una planilla asociada.'), { code: 'SPREADSHEET_NOT_FOUND' });
    if (this.discoveryPort?.setSpreadsheetAppProperties) {
      await this.discoveryPort.setSpreadsheetAppProperties(current.spreadsheetId, {
        flacsoResource: 'preinscription-spreadsheet',
        flacsoTargetId: targetId,
        flacsoDetached: 'true',
      });
    }
    const detached = { ...current, status: 'detached' as const, updatedAt: new Date() };
    await this.repository.save(detached);
    return detached;
  }

  async reconcileTargets(targets: AcademicTarget[]): Promise<TargetsReconciliationResult> {
    const items: TargetReconciliationItem[] = [];
    let hasBlocked = false;

    for (const target of targets) {
      if (!canProvisionTargetSpreadsheet(target)) continue;
      try {
        const config = await this.ensureForTarget(target);
        items.push({
          targetId: target.id,
          status: config.status ?? 'reconciled',
          spreadsheetId: config.spreadsheetId,
        });
      } catch (error) {
        hasBlocked = true;
        items.push({
          targetId: target.id,
          status: 'blocked',
          code: (error as any).code || 'DRIVE_RECONCILIATION_ERROR',
          message: error instanceof Error ? error.message : 'Error al reconciliar la planilla',
        });
      }
    }

    return {
      status: hasBlocked ? 'blocked' : 'completed',
      targets: items,
    };
  }

  private async executeEnsureForTarget(target: AcademicTarget): Promise<TargetSpreadsheetConfiguration> {
    const rootFolderId = await this.driveRootProvider();
    if (!rootFolderId) {
      throw new Error('La carpeta raíz de Google Drive todavía no está configurada desde el panel administrativo.');
    }

    await this.repository.ensureTarget(target);

    if (this.discoveryPort) {
      const previousConfig = await this.repository.get(target.id);
      // 1. Dynamic discovery in Drive by targetId
      const discovered = previousConfig?.status === 'detached'
        ? null
        : await this.discoveryPort.findByTargetId(rootFolderId, target.id);
      if (discovered) {
        const targetFolderId = this.discoveryPort.ensureTargetFolder
          ? await this.discoveryPort.ensureTargetFolder(rootFolderId, target)
          : rootFolderId;

        const needsRelocation = discovered.parentFolderId !== targetFolderId;
        const rootChanged = previousConfig?.rootFolderId && previousConfig.rootFolderId !== rootFolderId;

        if (needsRelocation && this.discoveryPort.moveSpreadsheet) {
          await this.discoveryPort.moveSpreadsheet(
            discovered.spreadsheetId,
            discovered.parentFolderId,
            targetFolderId,
          );
          discovered.parentFolderId = targetFolderId;
        }

        const status = needsRelocation || rootChanged ? 'reconciled' : 'unchanged';
        const configuration: TargetSpreadsheetConfiguration = {
          targetId: target.id,
          spreadsheetId: discovered.spreadsheetId,
          sheetName: discovered.sheetName,
          url: discovered.url,
          rootFolderId,
          status,
          lastDiscoveredAt: new Date(),
          updatedAt: new Date(),
          createdAt: previousConfig?.createdAt ?? new Date(),
        };
        await this.repository.save(configuration);
        return configuration;
      }

      // 2. Not found dynamically: check if historical row exists in target_spreadsheets as migration bridge
      const historical = previousConfig?.status === 'detached' ? null : previousConfig;
      if (historical) {
        if (this.discoveryPort.inspectSpreadsheet) {
          const inspected = await this.discoveryPort.inspectSpreadsheet(historical.spreadsheetId);
          if (!inspected || inspected.trashed || (inspected.mimeType && inspected.mimeType !== 'application/vnd.google-apps.spreadsheet')) {
            const blockedConfig: TargetSpreadsheetConfiguration = {
              targetId: target.id,
              spreadsheetId: historical.spreadsheetId,
              sheetName: historical.sheetName,
              url: historical.url,
              rootFolderId,
              status: 'blocked',
              lastDiscoveredAt: new Date(),
              updatedAt: new Date(),
            };
            await this.repository.save(blockedConfig);
            const error = new Error(`La planilla histórica (${historical.spreadsheetId}) para el destino "${target.id}" no es accesible o fue eliminada en Google Drive.`);
            (error as any).code = 'DRIVE_SPREADSHEET_UNAVAILABLE';
            throw error;
          }

          if (this.discoveryPort.setSpreadsheetAppProperties) {
            await this.discoveryPort.setSpreadsheetAppProperties(historical.spreadsheetId, {
              flacsoResource: 'preinscription-spreadsheet',
              flacsoTargetId: target.id,
              flacsoTargetRevision: target.configRevision ?? 'v1',
              flacsoSheetName: historical.sheetName,
            });
          }

          const targetFolderId = this.discoveryPort.ensureTargetFolder
            ? await this.discoveryPort.ensureTargetFolder(rootFolderId, target)
            : rootFolderId;

          const currentParent = inspected.parents?.[0] || '';
          if (currentParent !== targetFolderId && this.discoveryPort.moveSpreadsheet) {
            await this.discoveryPort.moveSpreadsheet(historical.spreadsheetId, currentParent, targetFolderId);
          }

          const configuration: TargetSpreadsheetConfiguration = {
            targetId: target.id,
            spreadsheetId: historical.spreadsheetId,
            sheetName: historical.sheetName,
            url: historical.url || `https://docs.google.com/spreadsheets/d/${historical.spreadsheetId}/edit`,
            rootFolderId,
            status: 'reconciled',
            lastDiscoveredAt: new Date(),
            updatedAt: new Date(),
          };
          await this.repository.save(configuration);
          return configuration;
        }
      }

      // 3. No existing spreadsheet found: provision a new one inside target folder
      const targetFolderId = this.discoveryPort.ensureTargetFolder
        ? await this.discoveryPort.ensureTargetFolder(rootFolderId, target)
        : rootFolderId;

      const created = await this.provisioner.create({
        targetId: target.id,
        configRevision: target.configRevision,
        title: target.title,
        folderId: targetFolderId,
        sheetName: this.sheetName,
        headers: buildSpreadsheetHeaders(),
      });

      const configuration: TargetSpreadsheetConfiguration = {
        targetId: target.id,
        spreadsheetId: created.spreadsheetId,
        sheetName: created.sheetName,
        url: created.url,
        rootFolderId,
        status: 'created',
        lastDiscoveredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.repository.save(configuration);
      return configuration;
    }

    // Fallback when discoveryPort is not provided (simple in-memory test mode)
    const existing = await this.repository.get(target.id);
    if (existing) return existing;

    const created = await this.provisioner.create({
      targetId: target.id,
      configRevision: target.configRevision,
      title: target.title,
      folderId: rootFolderId,
      sheetName: this.sheetName,
      headers: buildSpreadsheetHeaders(),
    });

    const configuration: TargetSpreadsheetConfiguration = {
      targetId: target.id,
      spreadsheetId: created.spreadsheetId,
      sheetName: created.sheetName,
      url: created.url,
      rootFolderId,
      status: 'created',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.repository.save(configuration);
    return configuration;
  }
}
