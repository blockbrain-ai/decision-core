/**
 * In-Memory Graph Edge Repository
 *
 * Map-based implementation with tenant isolation (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type {
  PolicyGraphEdge,
  PolicyGraphEdgeCreateInput,
  GraphEdgeType,
} from '../../contracts/clause.contracts.js';
import type { GraphEdgeRepository, GraphEdgeFilters } from '../interfaces/graph-edge.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

export class InMemoryGraphEdgeRepository implements GraphEdgeRepository {
  private store = new Map<string, Map<string, PolicyGraphEdge>>();

  private getTenantStore(tenantId: TenantId): Map<string, PolicyGraphEdge> {
    let tenant = this.store.get(tenantId);
    if (!tenant) {
      tenant = new Map();
      this.store.set(tenantId, tenant);
    }
    return tenant;
  }

  async create(tenantId: TenantId, input: PolicyGraphEdgeCreateInput): Promise<PolicyGraphEdge> {
    const id = generateUuidV7();
    const edge: PolicyGraphEdge = {
      ...input,
      id,
      tenantId,
      auditHash: hashCanonicalJson({ id, ...input, tenantId }),
      createdAt: new Date().toISOString(),
    };
    this.getTenantStore(tenantId).set(id, edge);
    return edge;
  }

  async delete(tenantId: TenantId, edgeId: string): Promise<boolean> {
    return this.getTenantStore(tenantId).delete(edgeId);
  }

  async findBySource(tenantId: TenantId, sourceId: string): Promise<PolicyGraphEdge[]> {
    return Array.from(this.getTenantStore(tenantId).values())
      .filter((e) => e.sourceId === sourceId);
  }

  async findByTarget(tenantId: TenantId, targetId: string): Promise<PolicyGraphEdge[]> {
    return Array.from(this.getTenantStore(tenantId).values())
      .filter((e) => e.targetId === targetId);
  }

  async findByEdgeType(tenantId: TenantId, edgeType: GraphEdgeType): Promise<PolicyGraphEdge[]> {
    return Array.from(this.getTenantStore(tenantId).values())
      .filter((e) => e.edgeType === edgeType);
  }

  async findByTenant(tenantId: TenantId, filters?: GraphEdgeFilters): Promise<PolicyGraphEdge[]> {
    let records = Array.from(this.getTenantStore(tenantId).values());

    if (filters) {
      if (filters.edgeType) records = records.filter((e) => e.edgeType === filters.edgeType);
      if (filters.sourceId) records = records.filter((e) => e.sourceId === filters.sourceId);
      if (filters.targetId) records = records.filter((e) => e.targetId === filters.targetId);
      if (filters.offset) records = records.slice(filters.offset);
      if (filters.limit) records = records.slice(0, filters.limit);
    }

    return records;
  }
}
