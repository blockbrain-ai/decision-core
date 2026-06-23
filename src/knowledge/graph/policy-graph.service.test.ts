/**
 * Policy Graph Service Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyGraphService, type EntityTypeResolver } from './policy-graph.service.js';
import { InMemoryGraphEdgeRepository } from '../../persistence/memory/in-memory-graph-edge.repository.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyGraphEdgeCreateInput } from '../../contracts/clause.contracts.js';
import type { EntityType } from './edge-types.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;

function createResolver(typeMap: Record<string, EntityType>): EntityTypeResolver {
  return {
    async resolveEntityType(_tenantId: TenantId, entityId: string): Promise<EntityType | null> {
      return typeMap[entityId] ?? null;
    },
  };
}

describe('PolicyGraphService', () => {
  let repo: InMemoryGraphEdgeRepository;
  let service: PolicyGraphService;
  let resolver: EntityTypeResolver;

  beforeEach(() => {
    repo = new InMemoryGraphEdgeRepository();
    resolver = createResolver({
      'clause-1': 'clause',
      'clause-2': 'clause',
      'surface-1': 'surface',
      'field-1': 'field',
      'regulation-1': 'regulation',
    });
    service = new PolicyGraphService(repo, resolver);
  });

  describe('addEdge', () => {
    it('creates a valid edge', async () => {
      const input: PolicyGraphEdgeCreateInput = {
        sourceId: 'clause-1',
        targetId: 'clause-2',
        edgeType: 'conflicts_with',
        metadata: {},
        correlationId: 'corr-1',
      };

      const edge = await service.addEdge(TENANT_A, input);
      expect(edge.id).toBeDefined();
      expect(edge.tenantId).toBe(TENANT_A);
      expect(edge.sourceId).toBe('clause-1');
      expect(edge.targetId).toBe('clause-2');
      expect(edge.edgeType).toBe('conflicts_with');
      expect(edge.auditHash).toBeDefined();
    });

    it('rejects edge with unknown source entity', async () => {
      const input: PolicyGraphEdgeCreateInput = {
        sourceId: 'unknown-entity',
        targetId: 'clause-2',
        edgeType: 'conflicts_with',
        metadata: {},
        correlationId: 'corr-1',
      };

      await expect(service.addEdge(TENANT_A, input)).rejects.toThrow('not found');
    });

    it('rejects edge with unknown target entity', async () => {
      const input: PolicyGraphEdgeCreateInput = {
        sourceId: 'clause-1',
        targetId: 'unknown-entity',
        edgeType: 'conflicts_with',
        metadata: {},
        correlationId: 'corr-1',
      };

      await expect(service.addEdge(TENANT_A, input)).rejects.toThrow('not found');
    });

    it('rejects edge that violates entity constraints', async () => {
      const input: PolicyGraphEdgeCreateInput = {
        sourceId: 'surface-1',
        targetId: 'clause-1',
        edgeType: 'conflicts_with',
        metadata: {},
        correlationId: 'corr-1',
      };

      await expect(service.addEdge(TENANT_A, input)).rejects.toThrow('does not allow source');
    });

    it('creates clause-to-surface constrains edge', async () => {
      const input: PolicyGraphEdgeCreateInput = {
        sourceId: 'clause-1',
        targetId: 'surface-1',
        edgeType: 'constrains',
        metadata: {},
        correlationId: 'corr-1',
      };

      const edge = await service.addEdge(TENANT_A, input);
      expect(edge.edgeType).toBe('constrains');
      expect(edge.targetId).toBe('surface-1');
    });
  });

  describe('removeEdge', () => {
    it('removes an existing edge and it is no longer retrievable', async () => {
      const input: PolicyGraphEdgeCreateInput = {
        sourceId: 'clause-1',
        targetId: 'clause-2',
        edgeType: 'depends_on',
        metadata: {},
        correlationId: 'corr-1',
      };

      const edge = await service.addEdge(TENANT_A, input);
      const removed = await service.removeEdge(TENANT_A, edge.id);
      expect(removed).toBe(true);

      const edges = await service.getEdgesBySource(TENANT_A, 'clause-1');
      expect(edges).toHaveLength(0);
    });

    it('returns false for non-existent edge', async () => {
      const removed = await service.removeEdge(TENANT_A, 'non-existent-id');
      expect(removed).toBe(false);
    });

    it('does not affect edges in other tenants', async () => {
      const input: PolicyGraphEdgeCreateInput = {
        sourceId: 'clause-1',
        targetId: 'clause-2',
        edgeType: 'depends_on',
        metadata: {},
        correlationId: 'corr-1',
      };

      const edge = await service.addEdge(TENANT_A, input);
      const removed = await service.removeEdge(TENANT_B, edge.id);
      expect(removed).toBe(false);

      const edges = await service.getEdgesBySource(TENANT_A, 'clause-1');
      expect(edges).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it('edges created in one tenant are not visible to another', async () => {
      const input: PolicyGraphEdgeCreateInput = {
        sourceId: 'clause-1',
        targetId: 'clause-2',
        edgeType: 'depends_on',
        metadata: {},
        correlationId: 'corr-1',
      };

      await service.addEdge(TENANT_A, input);

      const edgesA = await service.getEdgesBySource(TENANT_A, 'clause-1');
      const edgesB = await service.getEdgesBySource(TENANT_B, 'clause-1');

      expect(edgesA).toHaveLength(1);
      expect(edgesB).toHaveLength(0);
    });
  });
});
