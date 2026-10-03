import type { AcademicTarget } from '@flacso/contracts';
import { SUPPORTED_SPECIFIC_INPUTS, UNIVERSAL_INPUTS } from '../domain/form-definition.js';
import { isSupportedOfferType } from '../domain/form-profiles.js';
import type {
  TargetSpreadsheetConfiguration,
  TargetSpreadsheetRepository,
} from '../ports/target-spreadsheet-repository.js';

export interface SpreadsheetProvisioningCommand {
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

  constructor(
    private readonly repository: TargetSpreadsheetRepository,
    private readonly provisioner: SpreadsheetProvisioner,
    private readonly driveRootProvider: () => Promise<string | null>,
    private readonly sheetName = 'Sheet1',
  ) {}

  async ensureForTarget(target: AcademicTarget): Promise<TargetSpreadsheetConfiguration> {
    const existing = await this.repository.get(target.id);
    if (existing) return existing;

    const currentLock = this.locks.get(target.id);
    if (currentLock) return currentLock;

    const creation = this.createForTarget(target);
    this.locks.set(target.id, creation);
    try {
      return await creation;
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

  private async createForTarget(target: AcademicTarget): Promise<TargetSpreadsheetConfiguration> {
    const alreadyCreated = await this.repository.get(target.id);
    if (alreadyCreated) return alreadyCreated;

    const folderId = await this.driveRootProvider();
    if (!folderId) {
      throw new Error('La carpeta raíz de Google Drive todavía no está configurada desde el panel administrativo.');
    }

    await this.repository.ensureTarget(target);
    const created = await this.provisioner.create({
      title: target.title,
      folderId,
      sheetName: this.sheetName,
      headers: buildSpreadsheetHeaders(),
    });
    const configuration: TargetSpreadsheetConfiguration = {
      targetId: target.id,
      spreadsheetId: created.spreadsheetId,
      sheetName: created.sheetName,
      url: created.url,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.repository.save(configuration);
    return configuration;
  }
}
