import type { AcademicTarget, AgreementOption } from '@flacso/contracts';

export interface AcademicCatalog {
  listTargets(): Promise<AcademicTarget[]>;
  getTarget(id: string): Promise<AcademicTarget | null>;
  revalidateTarget(id: string): Promise<AcademicTarget | null>;
  revalidateTargets(): Promise<AcademicTarget[]>;
  listAgreements?(): Promise<AgreementOption[]>;
}
