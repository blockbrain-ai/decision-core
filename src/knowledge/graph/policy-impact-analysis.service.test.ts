/**
 * Policy Impact Analysis Service Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyImpactAnalysisService, type ProposedChange } from './policy-impact-analysis.service.js';
import { InMemoryGraphEdgeRepository } from '../../persistence/memory/in-memory-graph-edge.repository.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { EntityTypeResolver } from './policy-graph.service.js';
import type { EntityType } from './edge-types.js';

const TENANT_A = 'tenant-a' as TenantId;

function createResolver(typeMap: Record<string, EntityType>): EntityTypeResolver {
  return {
    async resolveEntityType(_tenantId: TenantId, entityId: string): Promise<EntityType | null> {
      return typeMap[entityId] ?? null;
    },
  };
}

describe('PolicyImpactAnalysisService', () => {
  let repo: InMemoryGraphEdgeRepository;
  let service: PolicyImpactAnalysisService;
  let resolver: EntityTypeResolver;

  beforeEach(() => {
    repo = new InMemoryGraphEdgeRepository();
    resolver = createResolver({
      'clause-1': 'clause',
      'clause-2': 'clause',
      'clause-3': 'clause',
      'rule-1': 'rule',
      'rule-2': 'rule',
      'surface-A': 'surface',
      'surface-B': 'surface',
      'surface-C': 'surface',
    });
    service = new PolicyImpactAnalysisService(repo, resolver);
  });

  async function seedEdge(sourceId: string, targetId: string, edgeType: string) {
    return repo.create(TENANT_A, {
      sourceId,
      targetId,
      edgeType: edgeType as any,
      metadata: {},
      correlationId: 'corr-seed',
    });
  }

  describe('analyzeChange', () => {
    it('reports affected surfaces', async () => {
      await seedEdge('clause-1', 'surface-A', 'constrains');
      await seedEdge('clause-1', 'surface-B', 'blocks');

      const change: ProposedChange = { changeType: 'modify', description: 'Update threshold' };
      const report = await service.analyzeChange(TENANT_A, 'clause-1', change);

      expect(report.clauseId).toBe('clause-1');
      expect(report.tenantId).toBe(TENANT_A);
      expect(report.affectedSurfaces).toContain('surface-A');
      expect(report.affectedSurfaces).toContain('surface-B');
    });

    it('reports conflicting clauses', async () => {
      await seedEdge('clause-1', 'clause-2', 'conflicts_with');

      const change: ProposedChange = { changeType: 'modify', description: 'Change wording' };
      const report = await service.analyzeChange(TENANT_A, 'clause-1', change);

      expect(report.conflictingClauses).toContain('clause-2');
    });

    it('reports dependent clauses', async () => {
      await seedEdge('clause-2', 'clause-1', 'depends_on');
      await seedEdge('clause-3', 'clause-1', 'inherits_from');

      const change: ProposedChange = { changeType: 'deactivate', description: 'Phase out clause' };
      const report = await service.analyzeChange(TENANT_A, 'clause-1', change);

      expect(report.dependentClauses).toContain('clause-2');
      expect(report.dependentClauses).toContain('clause-3');
    });

    it('reports only rule entities in downstreamRules', async () => {
      await seedEdge('clause-1', 'rule-1', 'triggers');
      await seedEdge('clause-1', 'clause-2', 'triggers');

      const change: ProposedChange = { changeType: 'modify', description: 'Update' };
      const report = await service.analyzeChange(TENANT_A, 'clause-1', change);

      expect(report.downstreamRules).toContain('rule-1');
      expect(report.downstreamRules).not.toContain('clause-2');
    });

    it('assigns high risk for delete with affected surfaces', async () => {
      await seedEdge('clause-1', 'surface-A', 'constrains');

      const change: ProposedChange = { changeType: 'delete', description: 'Remove clause' };
      const report = await service.analyzeChange(TENANT_A, 'clause-1', change);

      expect(report.riskLevel).toBe('high');
    });

    it('assigns medium risk for delete with no dependents or surfaces', async () => {
      const change: ProposedChange = { changeType: 'delete', description: 'Remove unused clause' };
      const report = await service.analyzeChange(TENANT_A, 'clause-isolated', change);

      expect(report.riskLevel).toBe('medium');
    });

    it('assigns low risk for modify with no graph connections', async () => {
      const change: ProposedChange = { changeType: 'modify', description: 'Typo fix' };
      const report = await service.analyzeChange(TENANT_A, 'clause-isolated', change);

      expect(report.riskLevel).toBe('low');
    });

    it('assigns high risk for deactivate with many surfaces', async () => {
      await seedEdge('clause-1', 'surface-A', 'constrains');
      await seedEdge('clause-1', 'surface-B', 'constrains');
      await seedEdge('clause-1', 'surface-C', 'constrains');

      const change: ProposedChange = { changeType: 'deactivate', description: 'Phase out' };
      const report = await service.analyzeChange(TENANT_A, 'clause-1', change);

      expect(report.riskLevel).toBe('high');
    });

    it('generates recommendations for high risk changes', async () => {
      await seedEdge('clause-1', 'surface-A', 'constrains');
      await seedEdge('clause-2', 'clause-1', 'depends_on');

      const change: ProposedChange = { changeType: 'delete', description: 'Remove clause' };
      const report = await service.analyzeChange(TENANT_A, 'clause-1', change);

      expect(report.recommendations).toContain('Requires human review before proceeding');
      expect(report.recommendations.some((r) => r.includes('affected surface'))).toBe(true);
      expect(report.recommendations.some((r) => r.includes('dependent clause'))).toBe(true);
      expect(report.recommendations.some((r) => r.includes('deactivation instead'))).toBe(true);
    });

    it('generates conflict resolution recommendations', async () => {
      await seedEdge('clause-1', 'clause-2', 'conflicts_with');
      await seedEdge('clause-1', 'surface-A', 'constrains');
      await seedEdge('clause-1', 'surface-B', 'constrains');
      await seedEdge('clause-1', 'surface-C', 'constrains');

      const change: ProposedChange = { changeType: 'modify', description: 'Update' };
      const report = await service.analyzeChange(TENANT_A, 'clause-1', change);

      expect(report.recommendations.some((r) => r.includes('conflict'))).toBe(true);
    });
  });
});
