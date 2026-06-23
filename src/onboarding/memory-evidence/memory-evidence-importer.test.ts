import { describe, it, expect } from 'vitest';
import { importMemoryEvidence, importMultipleExports } from './memory-evidence-importer.js';
import type { MemoryEvidenceExport } from './memory-evidence.contracts.js';

function makeExport(overrides?: Partial<MemoryEvidenceExport>): MemoryEvidenceExport {
  return {
    schemaVersion: 1,
    sourceId: 'test-source',
    sourceKind: 'gbrain',
    collectedBy: 'user-agent',
    collectedAt: '2026-01-01T00:00:00.000Z',
    consent: { readGranted: true, writeBackGranted: false, scope: ['onboarding'] },
    items: [
      {
        id: 'item-1',
        summary: 'Agent manages e-commerce operations',
        sourceRef: 'gbrain://pages/agent-setup',
        confidence: 0.85,
        sensitive: false,
      },
    ],
    ...overrides,
  };
}

describe('memory-evidence-importer', () => {
  describe('importMemoryEvidence', () => {
    it('imports valid export successfully', () => {
      const result = importMemoryEvidence(makeExport());
      expect(result.success).toBe(true);
      expect(result.sourceId).toBe('test-source');
      expect(result.sourceKind).toBe('gbrain');
      expect(result.itemCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(result.export).toBeDefined();
    });

    it('rejects invalid data', () => {
      const result = importMemoryEvidence({ bad: 'data' });
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects null', () => {
      const result = importMemoryEvidence(null);
      expect(result.success).toBe(false);
    });

    it('rejects when read consent not granted', () => {
      const exp = makeExport({
        consent: { readGranted: false, writeBackGranted: false, scope: [] },
      });
      const result = importMemoryEvidence(exp);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Read consent not granted');
    });

    it('allows no-consent when option disabled', () => {
      const exp = makeExport({
        consent: { readGranted: false, writeBackGranted: false, scope: [] },
      });
      const result = importMemoryEvidence(exp, { rejectWithoutConsent: false });
      expect(result.success).toBe(true);
    });

    it('truncates items exceeding maxItems', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: `item-${i}`,
        summary: `Item ${i}`,
        sourceRef: `ref-${i}`,
        confidence: 0.8,
        sensitive: false,
      }));

      const result = importMemoryEvidence(makeExport({ items }), { maxItems: 5 });
      expect(result.success).toBe(true);
      expect(result.itemCount).toBe(5);
      expect(result.skippedCount).toBe(15);
    });

    it('truncates long summaries', () => {
      const longSummary = 'x'.repeat(5000);
      const exp = makeExport({
        items: [{ id: 'long', summary: longSummary, sourceRef: 'ref', confidence: 0.5, sensitive: false }],
      });

      const result = importMemoryEvidence(exp, { maxSummaryLength: 100 });
      expect(result.success).toBe(true);
      expect(result.export!.items[0].summary.length).toBeLessThanOrEqual(103);
    });

    it('redacts secrets in items', () => {
      const exp = makeExport({
        items: [
          {
            id: 'secret',
            summary: 'Key is sk-abcdefghijklmnopqrstuvwxyz',
            sourceRef: 'ref',
            confidence: 0.5,
            sensitive: false,
          },
        ],
      });

      const result = importMemoryEvidence(exp);
      expect(result.success).toBe(true);
      expect(result.redactedCount).toBe(1);
      expect(result.export!.items[0].summary).toContain('[REDACTED');
    });

    it('imports empty items list', () => {
      const result = importMemoryEvidence(makeExport({ items: [] }));
      expect(result.success).toBe(true);
      expect(result.itemCount).toBe(0);
    });
  });

  describe('importMultipleExports', () => {
    it('imports multiple exports', () => {
      const exports = [
        makeExport({ sourceId: 'a' }),
        makeExport({ sourceId: 'b' }),
      ];

      const results = importMultipleExports(exports);
      expect(results).toHaveLength(2);
      expect(results[0].sourceId).toBe('a');
      expect(results[1].sourceId).toBe('b');
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('handles mixed valid and invalid exports', () => {
      const exports = [makeExport(), { bad: 'data' }, makeExport({ sourceId: 'c' })];
      const results = importMultipleExports(exports);
      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });
  });
});
