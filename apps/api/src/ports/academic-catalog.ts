import type { AcademicTarget, AgreementOption } from '@flacso/contracts';

export interface AcademicCatalog {
  listTargets(): Promise<AcademicTarget[]>;
  getTarget(id: string): Promise<AcademicTarget | null>;
  revalidateTarget(id: string): Promise<AcademicTarget | null>;
  revalidateTargets(): Promise<AcademicTarget[]>;
  /** Último catálogo guardado si tiene a lo sumo `maxAgeMs`; respaldo cuando WordPress no responde. */
  listCachedTargets?(maxAgeMs: number): Promise<AcademicTarget[] | null>;
  listAgreements?(): Promise<AgreementOption[]>;
}
