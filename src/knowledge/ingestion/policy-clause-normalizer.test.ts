import { describe, it, expect } from 'vitest';
import { normalizeClauses, normalizeText, computeClauseKey } from './policy-clause-normalizer.js';
import type { ExtractedClause } from './policy-clause-extractor.js';

function makeExtracted(overrides?: Partial<ExtractedClause>): ExtractedClause {
  return {
    text: 'Staff must verify identity.',
    clauseType: 'obligation',
    sectionId: 'section-0',
    headingPath: 'Policy > Section A',
    indexInSection: 0,
    confidence: 0.9,
    ...overrides,
  };
}

describe('PolicyClauseNormalizer', () => {
  describe('normalizeText', () => {
    it('lowercases text', () => {
      expect(normalizeText('Staff MUST verify')).toBe('staff must verify');
    });

    it('collapses whitespace', () => {
      expect(normalizeText('staff   must    verify')).toBe('staff must verify');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeText('  staff must verify  ')).toBe('staff must verify');
    });

    it('normalizes line endings', () => {
      expect(normalizeText('line1\r\nline2\rline3')).toBe('line1 line2 line3');
    });

    it('produces same result for equivalent text', () => {
      const a = normalizeText('Staff  Must\tVerify');
      const b = normalizeText('staff must verify');
      expect(a).toBe(b);
    });
  });

  describe('computeClauseKey', () => {
    it('generates key from heading path and index', () => {
      const key = computeClauseKey('Policy > Section A', 0);
      expect(key).toBe('policy/section-a:0');
    });

    it('handles nested paths', () => {
      const key = computeClauseKey('Root > Parent > Child', 2);
      expect(key).toBe('root/parent/child:2');
    });

    it('strips special characters', () => {
      const key = computeClauseKey('Anti-Money Laundering (AML)', 1);
      expect(key).toBe('anti-money-laundering-aml:1');
    });

    it('produces stable keys for same input', () => {
      const a = computeClauseKey('Policy > Section', 0);
      const b = computeClauseKey('Policy > Section', 0);
      expect(a).toBe(b);
    });
  });

  describe('normalizeClauses', () => {
    it('produces normalized clauses with keys and hashes', () => {
      const extracted = [makeExtracted()];
      const normalized = normalizeClauses(extracted);

      expect(normalized).toHaveLength(1);
      expect(normalized[0]!.clauseKey).toBe('policy/section-a:0');
      expect(normalized[0]!.normalizedHash).toMatch(/^[a-f0-9]{64}$/);
      expect(normalized[0]!.normalizedText).toBe('staff must verify identity.');
    });

    it('preserves original text alongside normalized text', () => {
      const extracted = [makeExtracted({ text: 'Staff MUST verify identity.' })];
      const normalized = normalizeClauses(extracted);

      expect(normalized[0]!.text).toBe('Staff MUST verify identity.');
      expect(normalized[0]!.normalizedText).toBe('staff must verify identity.');
    });

    it('produces stable hash — same text always gets same hash', () => {
      const a = normalizeClauses([makeExtracted({ text: 'Staff must verify.' })]);
      const b = normalizeClauses([makeExtracted({ text: 'Staff must verify.' })]);
      expect(a[0]!.normalizedHash).toBe(b[0]!.normalizedHash);
    });

    it('produces different hashes for different text', () => {
      const a = normalizeClauses([makeExtracted({ text: 'Staff must verify.' })]);
      const b = normalizeClauses([makeExtracted({ text: 'Staff must document.' })]);
      expect(a[0]!.normalizedHash).not.toBe(b[0]!.normalizedHash);
    });

    it('produces same hash for text differing only in line endings', () => {
      const a = normalizeClauses([makeExtracted({ text: 'Staff must\r\nverify.' })]);
      const b = normalizeClauses([makeExtracted({ text: 'Staff must\nverify.' })]);
      expect(a[0]!.normalizedHash).toBe(b[0]!.normalizedHash);
    });

    it('produces different hashes for text differing in case (hash uses original text)', () => {
      const a = normalizeClauses([makeExtracted({ text: 'STAFF MUST VERIFY.' })]);
      const b = normalizeClauses([makeExtracted({ text: 'staff must verify.' })]);
      expect(a[0]!.normalizedHash).not.toBe(b[0]!.normalizedHash);
    });
  });
});
