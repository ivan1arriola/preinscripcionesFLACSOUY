import { describe, it, expect } from 'vitest';
import {
  filterSpreadsheetTargets,
  summarizeSpreadsheetTargets,
  isAttentionTarget,
  type SpreadsheetTargetItem,
} from './admin-spreadsheet-view-model.js';

describe('admin-spreadsheet-view-model', () => {
  const sampleTargets: SpreadsheetTargetItem[] = [
    {
      targetId: 't1',
      title: 'Maestría en Educación y Sociedad',
      kind: 'academic_offer',
      spreadsheet: {
        spreadsheetId: 'sheet-1',
        sheetName: 'Inscripciones',
        status: 'unchanged',
        url: 'https://docs.google.com/spreadsheets/d/sheet-1',
      },
    },
    {
      targetId: 't2',
      title: 'Seminario de Políticas Públicas',
      kind: 'seminar',
      spreadsheet: {
        spreadsheetId: 'sheet-2',
        sheetName: 'Inscripciones',
        status: 'blocked',
      },
    },
    {
      targetId: 't3',
      title: 'Diploma en Género',
      kind: 'academic_offer',
      // No spreadsheet provisioned yet (pending)
    },
    {
      targetId: 't4',
      title: 'Seminario de Evaluación',
      kind: 'seminar',
      spreadsheet: {
        spreadsheetId: 'sheet-4',
        sheetName: 'Inscripciones',
        status: 'detached',
      },
    },
    {
      targetId: 't5',
      title: 'Diploma en Comunicación',
      kind: 'academic_offer',
      spreadsheet: {
        spreadsheetId: 'sheet-5',
        sheetName: 'Inscripciones',
        status: 'created',
      },
    },
  ];

  describe('summarizeSpreadsheetTargets', () => {
    it('calculates metrics correctly', () => {
      const summary = summarizeSpreadsheetTargets(sampleTargets);
      expect(summary).toEqual({
        total: 5,
        ready: 2, // t1 (unchanged), t5 (created)
        attention: 2, // t2 (blocked), t3 (missing)
        blocked: 1, // t2
        detached: 1, // t4
      });
    });

    it('handles empty targets list', () => {
      expect(summarizeSpreadsheetTargets([])).toEqual({
        total: 0,
        ready: 0,
        attention: 0,
        blocked: 0,
        detached: 0,
      });
    });
  });

  describe('filterSpreadsheetTargets', () => {
    it('filters by query case-insensitively and accent-tolerantly', () => {
      // Query "educacion" matches "Educación"
      const res = filterSpreadsheetTargets(sampleTargets, 'educacion', 'all', 'all');
      expect(res.map((t) => t.targetId)).toEqual(['t1']);

      // Query "politicas" matches "Políticas"
      const res2 = filterSpreadsheetTargets(sampleTargets, 'politicas', 'all', 'all');
      expect(res2.map((t) => t.targetId)).toEqual(['t2']);
    });

    it('filters by kind', () => {
      const seminars = filterSpreadsheetTargets(sampleTargets, '', 'seminar', 'all');
      expect(seminars.map((t) => t.targetId).sort()).toEqual(['t2', 't4'].sort());

      const offers = filterSpreadsheetTargets(sampleTargets, '', 'offer', 'all');
      expect(offers.map((t) => t.targetId).sort()).toEqual(['t1', 't3', 't5'].sort());
    });

    it('filters by status', () => {
      const attention = filterSpreadsheetTargets(sampleTargets, '', 'all', 'attention');
      expect(attention.map((t) => t.targetId).sort()).toEqual(['t2', 't3'].sort());

      const ready = filterSpreadsheetTargets(sampleTargets, '', 'all', 'ready');
      expect(ready.map((t) => t.targetId).sort()).toEqual(['t1', 't5'].sort());

      const detached = filterSpreadsheetTargets(sampleTargets, '', 'all', 'detached');
      expect(detached.map((t) => t.targetId)).toEqual(['t4']);
    });

    it('sorts attention items first, then alphabetical by title', () => {
      const res = filterSpreadsheetTargets(sampleTargets, '', 'all', 'all');
      // Attention items (t3: Diploma en Género, t2: Seminario de Políticas Públicas)
      // Then ready/other items (t5: Diploma en Comunicación, t1: Maestría en Educación y Sociedad, t4: Seminario de Evaluación)
      expect(isAttentionTarget(res[0]!)).toBe(true);
      expect(isAttentionTarget(res[1]!)).toBe(true);
      expect(isAttentionTarget(res[2]!)).toBe(false);
      expect(res[0]!.title).toBe('Diploma en Género');
      expect(res[1]!.title).toBe('Seminario de Políticas Públicas');
    });
  });
});
