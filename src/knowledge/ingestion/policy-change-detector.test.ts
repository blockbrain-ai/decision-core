import { describe, it, expect } from 'vitest';
import { detectChanges } from './policy-change-detector.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';
import type { NormalizedClause } from './policy-clause-normalizer.js';

function makeNormalized(overrides?: Partial<NormalizedClause>): NormalizedClause {
  return {
    text: 'Staff must verify identity.',
    normalizedText: 'staff must verify identity.',
    clauseKey: 'policy/section:0',
    normalizedHash: 'hash-aaa',
    clauseType: 'obligation',
    sectionId: 'section-0',
    headingPath: 'Policy > Section',
    indexInSection: 0,
    confidence: 0.9,
    ...overrides,
  };
}

function makeExisting(overrides?: Partial<PolicyClause>): PolicyClause {
  return {
    id: 'clause-1',
    tenantId: 'tenant-1',
    clauseKey: 'policy/section:0',
    text: 'Staff must verify identity.',
    normalizedHash: 'hash-aaa',
    clauseType: 'obligation',
    sectionId: 'section-0',
    sourceDocumentId: 'doc-1',
    status: 'draft',
    effectiveDate: null,
    expiryDate: null,
    correlationId: 'corr-1',
    auditHash: 'audit-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PolicyChangeDetector', () => {
  it('identifies all clauses as added when no existing clauses', () => {
    const newClauses = [
      makeNormalized({ clauseKey: 'a:0' }),
      makeNormalized({ clauseKey: 'a:1' }),
    ];
    const report = detectChanges(newClauses, []);

    expect(report.added).toHaveLength(2);
    expect(report.modified).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.unchanged).toHaveLength(0);
  });

  it('identifies unchanged clauses when hashes match', () => {
    const newClauses = [makeNormalized({ clauseKey: 'a:0', normalizedHash: 'same-hash' })];
    const existing = [makeExisting({ clauseKey: 'a:0', normalizedHash: 'same-hash' })];

    const report = detectChanges(newClauses, existing);

    expect(report.unchanged).toHaveLength(1);
    expect(report.added).toHaveLength(0);
    expect(report.modified).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
  });

  it('identifies modified clauses when key matches but hash differs', () => {
    const newClauses = [makeNormalized({ clauseKey: 'a:0', normalizedHash: 'new-hash' })];
    const existing = [makeExisting({ clauseKey: 'a:0', normalizedHash: 'old-hash' })];

    const report = detectChanges(newClauses, existing);

    expect(report.modified).toHaveLength(1);
    expect(report.modified[0]!.previous.normalizedHash).toBe('old-hash');
    expect(report.modified[0]!.current.normalizedHash).toBe('new-hash');
  });

  it('identifies removed clauses not present in new ingestion', () => {
    const newClauses = [makeNormalized({ clauseKey: 'a:0' })];
    const existing = [
      makeExisting({ clauseKey: 'a:0', normalizedHash: 'hash-aaa' }),
      makeExisting({ clauseKey: 'b:0', normalizedHash: 'hash-bbb' }),
    ];

    const report = detectChanges(newClauses, existing);

    expect(report.removed).toHaveLength(1);
    expect(report.removed[0]!.clauseKey).toBe('b:0');
  });

  it('handles mixed changes correctly', () => {
    const newClauses = [
      makeNormalized({ clauseKey: 'a:0', normalizedHash: 'unchanged-hash' }),
      makeNormalized({ clauseKey: 'b:0', normalizedHash: 'modified-hash-new' }),
      makeNormalized({ clauseKey: 'c:0', normalizedHash: 'added-hash' }),
    ];
    const existing = [
      makeExisting({ clauseKey: 'a:0', normalizedHash: 'unchanged-hash' }),
      makeExisting({ clauseKey: 'b:0', normalizedHash: 'modified-hash-old' }),
      makeExisting({ clauseKey: 'd:0', normalizedHash: 'removed-hash' }),
    ];

    const report = detectChanges(newClauses, existing);

    expect(report.unchanged).toHaveLength(1);
    expect(report.modified).toHaveLength(1);
    expect(report.added).toHaveLength(1);
    expect(report.removed).toHaveLength(1);
  });

  it('handles empty new clauses (all removed)', () => {
    const existing = [
      makeExisting({ clauseKey: 'a:0' }),
      makeExisting({ clauseKey: 'b:0' }),
    ];
    const report = detectChanges([], existing);

    expect(report.removed).toHaveLength(2);
    expect(report.added).toHaveLength(0);
  });

  it('handles both empty (no changes)', () => {
    const report = detectChanges([], []);

    expect(report.added).toHaveLength(0);
    expect(report.modified).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.unchanged).toHaveLength(0);
  });
});
