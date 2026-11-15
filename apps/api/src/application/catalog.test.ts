import { describe, it, expect } from 'vitest';
import { FixtureAcademicCatalog } from '../infrastructure/fixtures/fixture-academic-catalog.js';
import { discoverTargets } from './discover-targets.js';
import { getTargetForm } from './get-target-form.js';

describe('Catalog Application Use Cases & Fixture Adapter', () => {
  const catalog = new FixtureAcademicCatalog();

  it('lists and discovers targets with correct diagnostics', async () => {
    const targets = await discoverTargets(catalog);
    expect(targets.length).toBeGreaterThanOrEqual(4);

    const davia = targets.find((t) => t.id === 'davia-c11');
    expect(davia).toBeDefined();
    expect(davia?.status).toBe('operational');
    expect(davia?.registrationOpen).toBe(true);

    const mg = targets.find((t) => t.id === 'mg-c8');
    expect(mg).toBeDefined();
    expect(mg?.status).toBe('closed');
    expect(mg?.registrationOpen).toBe(false);

    const seminario = targets.find((t) => t.id === 'seminario-metodologia-ed3');
    expect(seminario).toBeDefined();
    expect(seminario?.status).toBe('operational');
    expect(seminario?.kind).toBe('seminar');

    const incompatible = targets.find((t) => t.id === 'oferta-incompatible');
    expect(incompatible).toBeDefined();
    expect(incompatible?.status).toBe('incompatible');
    expect(incompatible?.issues.length).toBeGreaterThan(0);
    expect(incompatible?.issues[0]).toContain('unsupported_offer_type: doctorado');
  });

  it('retrieves and composes form for an open valid target', async () => {
    const result = await getTargetForm(catalog, 'davia-c11');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.form.targetId).toBe('davia-c11');
    expect(result.form.configRevision).toBe('davia-c11-v1');
    expect(result.form.effectiveRevision).toBe('davia-c11-v1:canonical-v2');
    expect(result.form.inputs.map((i) => i.key)).toEqual(
      expect.arrayContaining(['nombre1', 'apellido1', 'email', 'documento', 'mencion'])
    );
    expect(result.form.orientations).toEqual(['Educación', 'Políticas Públicas']);
    expect(result.form.mentions).toEqual(['Tecnología Educativa', 'Gestión de Entornos Digitales']);
    expect(result.form.steps.length).toBe(6);
  });

  it('returns NOT_FOUND for a nonexistent target', async () => {
    const result = await getTargetForm(catalog, 'no-existe');
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns INCOMPATIBLE_FORM for a target with unsupported doctorado', async () => {
    const result = await getTargetForm(catalog, 'oferta-incompatible');
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INCOMPATIBLE_FORM');
    expect(result.issues).toBeDefined();
    expect(result.issues?.[0]).toContain('unsupported_offer_type: doctorado');
  });
});
