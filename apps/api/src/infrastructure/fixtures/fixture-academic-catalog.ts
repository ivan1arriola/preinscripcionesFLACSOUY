import type { AcademicTarget } from '@flacso/contracts';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import fixtureData from '../../fixtures/wordpress-preinscriptions.json' with { type: 'json' };

interface WordPressV1Fixture {
  version: number;
  targets: AcademicTarget[];
}

export class FixtureAcademicCatalog implements AcademicCatalog {
  private targets: AcademicTarget[];

  constructor(customTargets?: AcademicTarget[]) {
    if (customTargets) {
      this.targets = customTargets;
    } else {
      const data = fixtureData as unknown as WordPressV1Fixture;
      this.targets = data.targets ?? [];
    }
  }

  async listTargets(): Promise<AcademicTarget[]> {
    return structuredClone(this.targets);
  }

  async getTarget(id: string): Promise<AcademicTarget | null> {
    const found = this.targets.find((t) => t.id === id);
    return found ? structuredClone(found) : null;
  }

  async revalidateTarget(id: string): Promise<AcademicTarget | null> {
    return this.getTarget(id);
  }

  async revalidateTargets(): Promise<AcademicTarget[]> {
    return structuredClone(this.targets);
  }
}
