/**
 * Policy Graph Query Service Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyGraphQueryService } from './policy-graph-query.service.js';
import { InMemoryGraphEdgeRepository } from '../../persistence/memory/in-memory-graph-edge.repository.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function makeClause(id: string, tenantId: TenantId): PolicyClause {
  return {
    id,
    tenantId,
    clauseKey: `key-${id}`,
    text: `Clause text for ${id}`,
    normalizedHash: 'hash-' + id,
    clauseType: 'obligation',
    sectionId: 'section-1',
    sourceDocumentId: 'doc-1',
    status: 'active',
    effectiveDate: null,
    expiryDate: null,
    correlationId: 'corr-1',
    auditHash: 'audit-' + id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createMockClauseRepository(clauses: PolicyClause[]): ClauseRepository {
  return {
    async create() { throw new Error('not implemented'); },
    async findById(_tenantId: TenantId, id: string) {
      return clauses.find((c) => c.id === id) ?? null;
    },
    async findByTenant() { return []; },
    async findBySourceDocument() { return []; },
    async findByStatus() { return []; },
    async update() { return null; },
  };
}

describe('PolicyGraphQueryService', () => {
  let repo: InMemoryGraphEdgeRepository;
  let queryService: PolicyGraphQueryService;
  let clauseRepo: ClauseRepository;

  beforeEach(async () => {
    repo = new InMemoryGraphEdgeRepository();
    clauseRepo = createMockClauseRepository([
      makeClause('clause-1', TENANT_A),
      makeClause('clause-2', TENANT_A),
      makeClause('clause-3', TENANT_A),
      makeClause('clause-4', TENANT_A),
      makeClause('clause-5', TENANT_A),
      makeClause('clause-6', TENANT_A),
    ]);
    queryService = new PolicyGraphQueryService(repo, clauseRepo);
  });

  async function seedEdge(
    tenantId: TenantId,
    sourceId: string,
    targetId: string,
    edgeType: string,
  ) {
    return repo.create(tenantId, {
      sourceId,
      targetId,
      edgeType: edgeType as any,
      metadata: {},
      correlationId: 'corr-seed',
    });
  }

  describe('clausesForSurface', () => {
    it('returns full clause entities connected to a surface via constrains edges', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'surface-A', 'constrains');
      await seedEdge(TENANT_A, 'clause-2', 'surface-A', 'constrains');
      await seedEdge(TENANT_A, 'clause-3', 'surface-B', 'constrains');

      const clauses = await queryService.clausesForSurface(TENANT_A, 'surface-A');
      expect(clauses).toHaveLength(2);
      expect(clauses[0].id).toBe('clause-1');
      expect(clauses[1].id).toBe('clause-2');
      expect(clauses[0].text).toContain('Clause text');
    });

    it('includes clauses that block or trigger a surface', async () => {
      await seedEdge(TENANT_A, 'clause-4', 'surface-A', 'blocks');
      await seedEdge(TENANT_A, 'clause-5', 'surface-A', 'triggers');

      const clauses = await queryService.clausesForSurface(TENANT_A, 'surface-A');
      const ids = clauses.map((c) => c.id);
      expect(ids).toContain('clause-4');
      expect(ids).toContain('clause-5');
    });

    it('does not include non-surface-relevant edge types', async () => {
      await seedEdge(TENANT_A, 'clause-6', 'surface-A', 'depends_on');

      const clauses = await queryService.clausesForSurface(TENANT_A, 'surface-A');
      const ids = clauses.map((c) => c.id);
      expect(ids).not.toContain('clause-6');
    });

    it('deduplicates clauses', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'surface-A', 'constrains');
      await seedEdge(TENANT_A, 'clause-1', 'surface-A', 'blocks');

      const clauses = await queryService.clausesForSurface(TENANT_A, 'surface-A');
      expect(clauses).toHaveLength(1);
    });

    it('throws if ClauseRepository is not provided', async () => {
      const serviceNoRepo = new PolicyGraphQueryService(repo);
      await seedEdge(TENANT_A, 'clause-1', 'surface-A', 'constrains');

      await expect(serviceNoRepo.clausesForSurface(TENANT_A, 'surface-A'))
        .rejects.toThrow('ClauseRepository is required');
    });
  });

  describe('surfacesImpactedByClause', () => {
    it('returns directly connected surfaces', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'surface-A', 'constrains');
      await seedEdge(TENANT_A, 'clause-1', 'surface-B', 'blocks');

      const surfaces = await queryService.surfacesImpactedByClause(TENANT_A, 'clause-1');
      expect(surfaces).toContain('surface-A');
      expect(surfaces).toContain('surface-B');
    });

    it('follows transitive clause relationships', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'refines');
      await seedEdge(TENANT_A, 'clause-2', 'surface-X', 'constrains');

      const surfaces = await queryService.surfacesImpactedByClause(TENANT_A, 'clause-1');
      expect(surfaces).toContain('surface-X');
    });

    it('follows reverse dependency edges', async () => {
      await seedEdge(TENANT_A, 'clause-2', 'clause-1', 'depends_on');
      await seedEdge(TENANT_A, 'clause-2', 'surface-Y', 'constrains');

      const surfaces = await queryService.surfacesImpactedByClause(TENANT_A, 'clause-1');
      expect(surfaces).toContain('surface-Y');
    });

    it('handles cycles without infinite loop', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'depends_on');
      await seedEdge(TENANT_A, 'clause-2', 'clause-1', 'depends_on');
      await seedEdge(TENANT_A, 'clause-2', 'surface-A', 'constrains');

      const surfaces = await queryService.surfacesImpactedByClause(TENANT_A, 'clause-1');
      expect(surfaces).toContain('surface-A');
    });
  });

  describe('clauseNeighbourhood', () => {
    it('returns edges within specified depth', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'depends_on');
      await seedEdge(TENANT_A, 'clause-2', 'clause-3', 'refines');
      await seedEdge(TENANT_A, 'clause-3', 'clause-4', 'narrows');

      const neighbourhood = await queryService.clauseNeighbourhood(TENANT_A, 'clause-1', 2);

      expect(neighbourhood.centerId).toBe('clause-1');
      expect(neighbourhood.nodeIds).toContain('clause-1');
      expect(neighbourhood.nodeIds).toContain('clause-2');
      expect(neighbourhood.nodeIds).toContain('clause-3');
      expect(neighbourhood.depth).toBe(2);
    });

    it('does not traverse beyond depth', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'depends_on');
      await seedEdge(TENANT_A, 'clause-2', 'clause-3', 'depends_on');
      await seedEdge(TENANT_A, 'clause-3', 'clause-4', 'depends_on');

      const neighbourhood = await queryService.clauseNeighbourhood(TENANT_A, 'clause-1', 1);

      expect(neighbourhood.nodeIds).toContain('clause-1');
      expect(neighbourhood.nodeIds).toContain('clause-2');
      expect(neighbourhood.nodeIds).not.toContain('clause-3');
      expect(neighbourhood.nodeIds).not.toContain('clause-4');
    });

    it('includes incoming edges', async () => {
      await seedEdge(TENANT_A, 'clause-2', 'clause-1', 'depends_on');

      const neighbourhood = await queryService.clauseNeighbourhood(TENANT_A, 'clause-1', 1);
      expect(neighbourhood.nodeIds).toContain('clause-2');
      expect(neighbourhood.edges).toHaveLength(1);
    });

    it('defaults to depth 2', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'depends_on');
      await seedEdge(TENANT_A, 'clause-2', 'clause-3', 'refines');

      const neighbourhood = await queryService.clauseNeighbourhood(TENANT_A, 'clause-1');
      expect(neighbourhood.depth).toBe(2);
      expect(neighbourhood.nodeIds).toContain('clause-3');
    });
  });

  describe('detectConflicts', () => {
    it('finds outgoing conflict edges', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'conflicts_with');

      const result = await queryService.detectConflicts(TENANT_A, 'clause-1');
      expect(result.clauseId).toBe('clause-1');
      expect(result.conflictsWith).toContain('clause-2');
    });

    it('finds incoming conflict edges', async () => {
      await seedEdge(TENANT_A, 'clause-2', 'clause-1', 'conflicts_with');

      const result = await queryService.detectConflicts(TENANT_A, 'clause-1');
      expect(result.conflictsWith).toContain('clause-2');
    });

    it('returns empty when no conflicts exist', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'depends_on');

      const result = await queryService.detectConflicts(TENANT_A, 'clause-1');
      expect(result.conflictsWith).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('graph queries respect tenantId scoping', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'surface-A', 'constrains');
      await seedEdge(TENANT_B, 'clause-1', 'surface-B', 'constrains');

      const clausesA = await queryService.clausesForSurface(TENANT_A, 'surface-A');
      const clausesB = await queryService.clausesForSurface(TENANT_B, 'surface-A');

      expect(clausesA).toHaveLength(1);
      expect(clausesB).toHaveLength(0);
    });

    it('conflict detection is tenant-scoped', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'conflicts_with');

      const resultA = await queryService.detectConflicts(TENANT_A, 'clause-1');
      const resultB = await queryService.detectConflicts(TENANT_B, 'clause-1');

      expect(resultA.conflictsWith).toHaveLength(1);
      expect(resultB.conflictsWith).toHaveLength(0);
    });

    it('neighbourhood traversal is tenant-scoped', async () => {
      await seedEdge(TENANT_A, 'clause-1', 'clause-2', 'depends_on');
      await seedEdge(TENANT_B, 'clause-1', 'clause-3', 'depends_on');

      const neighbourhoodA = await queryService.clauseNeighbourhood(TENANT_A, 'clause-1', 1);
      expect(neighbourhoodA.nodeIds).toContain('clause-2');
      expect(neighbourhoodA.nodeIds).not.toContain('clause-3');
    });
  });
});
