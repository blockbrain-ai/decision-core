/**
 * GraphEdgeRepository Interface
 *
 * Persistence interface for PolicyGraphEdge entities.
 * All methods take tenantId as first parameter (D2 standard).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type {
  PolicyGraphEdge,
  PolicyGraphEdgeCreateInput,
  GraphEdgeType,
} from '../../contracts/clause.contracts.js';

export interface GraphEdgeFilters {
  edgeType?: GraphEdgeType;
  sourceId?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}

export interface GraphEdgeRepository {
  create(tenantId: TenantId, input: PolicyGraphEdgeCreateInput): Promise<PolicyGraphEdge>;
  delete(tenantId: TenantId, edgeId: string): Promise<boolean>;
  findBySource(tenantId: TenantId, sourceId: string): Promise<PolicyGraphEdge[]>;
  findByTarget(tenantId: TenantId, targetId: string): Promise<PolicyGraphEdge[]>;
  findByEdgeType(tenantId: TenantId, edgeType: GraphEdgeType): Promise<PolicyGraphEdge[]>;
  findByTenant(tenantId: TenantId, filters?: GraphEdgeFilters): Promise<PolicyGraphEdge[]>;
}
