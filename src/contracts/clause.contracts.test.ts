import { describe, it, expect } from 'vitest';
import {
  PolicySourceDocumentSchema,
  PolicyClauseSchema,
  PolicyControlSchema,
  PolicyGraphEdgeSchema,
  CompiledRuleSetSchema,
  ClauseTypeSchema,
  GraphEdgeTypeSchema,
  CLAUSE_TYPES,
  GRAPH_EDGE_TYPES,
} from './clause.contracts.js';

describe('clause.contracts', () => {
  describe('ClauseTypeSchema', () => {
    it('accepts all 12 clause types', () => {
      expect(CLAUSE_TYPES).toHaveLength(12);
      for (const t of CLAUSE_TYPES) {
        expect(ClauseTypeSchema.parse(t)).toBe(t);
      }
    });

    it('rejects invalid clause type', () => {
      expect(() => ClauseTypeSchema.parse('invalid')).toThrow();
    });
  });

  describe('GraphEdgeTypeSchema', () => {
    it('accepts all 16 edge types', () => {
      expect(GRAPH_EDGE_TYPES).toHaveLength(16);
      for (const t of GRAPH_EDGE_TYPES) {
        expect(GraphEdgeTypeSchema.parse(t)).toBe(t);
      }
    });

    it('rejects invalid edge type', () => {
      expect(() => GraphEdgeTypeSchema.parse('invalid')).toThrow();
    });
  });

  describe('PolicySourceDocumentSchema', () => {
    const valid = {
      id: 'doc-1',
      tenantId: 'tenant-a',
      title: 'AML Policy v2',
      sourceHash: 'abc123',
      sections: [{ id: 'sec-1', title: 'Introduction', order: 0 }],
      importedAt: '2026-01-01T00:00:00.000Z',
      status: 'imported',
      correlationId: 'corr-1',
      auditHash: 'hash-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('validates a correct document', () => {
      expect(PolicySourceDocumentSchema.parse(valid)).toEqual(valid);
    });

    it('rejects missing title', () => {
      const { title: _, ...invalid } = valid;
      expect(() => PolicySourceDocumentSchema.parse(invalid)).toThrow();
    });

    it('rejects invalid status', () => {
      expect(() => PolicySourceDocumentSchema.parse({ ...valid, status: 'bad' })).toThrow();
    });
  });

  describe('PolicyClauseSchema', () => {
    const valid = {
      id: 'clause-1',
      tenantId: 'tenant-a',
      clauseKey: 'AML-001',
      text: 'All transactions above $10,000 require dual authorization.',
      normalizedHash: 'sha256hex',
      clauseType: 'threshold',
      sectionId: 'sec-1',
      sourceDocumentId: 'doc-1',
      status: 'draft',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-1',
      auditHash: 'hash-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('validates a correct clause', () => {
      expect(PolicyClauseSchema.parse(valid)).toEqual(valid);
    });

    it('accepts all clause types', () => {
      for (const t of CLAUSE_TYPES) {
        expect(() => PolicyClauseSchema.parse({ ...valid, clauseType: t })).not.toThrow();
      }
    });

    it('rejects invalid status', () => {
      expect(() => PolicyClauseSchema.parse({ ...valid, status: 'deleted' })).toThrow();
    });

    it('accepts nullable dates', () => {
      const withDates = { ...valid, effectiveDate: '2026-06-01', expiryDate: '2027-01-01' };
      expect(PolicyClauseSchema.parse(withDates).effectiveDate).toBe('2026-06-01');
    });
  });

  describe('PolicyControlSchema', () => {
    const valid = {
      id: 'ctrl-1',
      tenantId: 'tenant-a',
      clauseId: 'clause-1',
      controlType: 'amount_threshold',
      parameters: { limit: 10000, currency: 'USD' },
      correlationId: 'corr-1',
      auditHash: 'hash-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('validates a correct control', () => {
      expect(PolicyControlSchema.parse(valid)).toEqual(valid);
    });

    it('rejects invalid control type', () => {
      expect(() => PolicyControlSchema.parse({ ...valid, controlType: 'bad' })).toThrow();
    });
  });

  describe('PolicyGraphEdgeSchema', () => {
    const valid = {
      id: 'edge-1',
      tenantId: 'tenant-a',
      sourceId: 'clause-1',
      targetId: 'clause-2',
      edgeType: 'depends_on',
      metadata: { reason: 'prerequisite' },
      correlationId: 'corr-1',
      auditHash: 'hash-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    it('validates a correct edge', () => {
      expect(PolicyGraphEdgeSchema.parse(valid)).toEqual(valid);
    });

    it('accepts all 16 edge types', () => {
      for (const t of GRAPH_EDGE_TYPES) {
        expect(() => PolicyGraphEdgeSchema.parse({ ...valid, edgeType: t })).not.toThrow();
      }
    });

    it('rejects invalid edge type', () => {
      expect(() => PolicyGraphEdgeSchema.parse({ ...valid, edgeType: 'bad' })).toThrow();
    });
  });

  describe('CompiledRuleSetSchema', () => {
    const valid = {
      id: 'rs-1',
      tenantId: 'tenant-a',
      name: 'AML Rules v1',
      version: 1,
      status: 'active',
      clauseIds: ['clause-1', 'clause-2'],
      compiledAt: '2026-01-01T00:00:00.000Z',
      activatedAt: '2026-01-01T00:00:00.000Z',
      correlationId: 'corr-1',
      auditHash: 'hash-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('validates a correct rule set', () => {
      expect(CompiledRuleSetSchema.parse(valid)).toEqual(valid);
    });

    it('rejects version 0', () => {
      expect(() => CompiledRuleSetSchema.parse({ ...valid, version: 0 })).toThrow();
    });

    it('accepts nullable activatedAt', () => {
      expect(CompiledRuleSetSchema.parse({ ...valid, activatedAt: null }).activatedAt).toBeNull();
    });
  });
});
