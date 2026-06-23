import { describe, it, expect } from 'vitest';
import { computeClauseHash, isValidTransition, transitionStatus, isEnforceable } from './clause.entity.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';

function makeClause(overrides?: Partial<PolicyClause>): PolicyClause {
  return {
    id: 'clause-1',
    tenantId: 'tenant-a',
    clauseKey: 'AML-001',
    text: 'Sample clause text.',
    normalizedHash: 'hash',
    clauseType: 'obligation',
    sectionId: 'sec-1',
    sourceDocumentId: 'doc-1',
    status: 'active',
    effectiveDate: null,
    expiryDate: null,
    correlationId: 'corr-1',
    auditHash: 'audit-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('clause.entity', () => {
  describe('computeClauseHash', () => {
    it('returns deterministic hash for same text', () => {
      const h1 = computeClauseHash('Hello world');
      const h2 = computeClauseHash('Hello world');
      expect(h1).toBe(h2);
    });

    it('returns different hash for different text', () => {
      const h1 = computeClauseHash('Hello world');
      const h2 = computeClauseHash('Hello World');
      expect(h1).not.toBe(h2);
    });

    it('normalizes line endings', () => {
      const h1 = computeClauseHash('line1\nline2');
      const h2 = computeClauseHash('line1\r\nline2');
      expect(h1).toBe(h2);
    });

    it('trims trailing whitespace per line', () => {
      const h1 = computeClauseHash('line1\nline2');
      const h2 = computeClauseHash('line1  \nline2  ');
      expect(h1).toBe(h2);
    });
  });

  describe('isValidTransition', () => {
    it('allows draft → approved', () => {
      expect(isValidTransition('draft', 'approved')).toBe(true);
    });

    it('allows draft → superseded', () => {
      expect(isValidTransition('draft', 'superseded')).toBe(true);
    });

    it('allows approved → active', () => {
      expect(isValidTransition('approved', 'active')).toBe(true);
    });

    it('allows active → superseded', () => {
      expect(isValidTransition('active', 'superseded')).toBe(true);
    });

    it('denies active → draft', () => {
      expect(isValidTransition('active', 'draft')).toBe(false);
    });

    it('denies superseded → anything', () => {
      expect(isValidTransition('superseded', 'draft')).toBe(false);
      expect(isValidTransition('superseded', 'active')).toBe(false);
    });
  });

  describe('transitionStatus', () => {
    it('returns updated clause on valid transition', () => {
      const clause = makeClause({ status: 'draft' });
      const result = transitionStatus(clause, 'approved');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
      expect(result!.updatedAt).not.toBe(clause.updatedAt);
    });

    it('returns null on invalid transition', () => {
      const clause = makeClause({ status: 'superseded' });
      const result = transitionStatus(clause, 'active');
      expect(result).toBeNull();
    });
  });

  describe('isEnforceable', () => {
    it('returns true for active clause with no dates', () => {
      expect(isEnforceable(makeClause())).toBe(true);
    });

    it('returns false for draft clause', () => {
      expect(isEnforceable(makeClause({ status: 'draft' }))).toBe(false);
    });

    it('returns false if effective date is in the future', () => {
      expect(isEnforceable(makeClause({ effectiveDate: '2099-01-01T00:00:00.000Z' }))).toBe(false);
    });

    it('returns false if expiry date is in the past', () => {
      expect(isEnforceable(makeClause({ expiryDate: '2020-01-01T00:00:00.000Z' }))).toBe(false);
    });

    it('respects asOf parameter', () => {
      const clause = makeClause({ effectiveDate: '2026-06-01T00:00:00.000Z' });
      expect(isEnforceable(clause, '2026-07-01T00:00:00.000Z')).toBe(true);
      expect(isEnforceable(clause, '2026-05-01T00:00:00.000Z')).toBe(false);
    });
  });
});
