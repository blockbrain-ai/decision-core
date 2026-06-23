/**
 * ClauseRepository Interface
 *
 * Persistence interface for PolicyClause entities.
 * All methods take tenantId as first parameter (D2 standard).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type {
  PolicyClause,
  PolicyClauseCreateInput,
  ClauseStatus,
  ClauseType,
} from '../../contracts/clause.contracts.js';

export interface ClauseFilters {
  status?: ClauseStatus;
  clauseType?: ClauseType;
  sourceDocumentId?: string;
  sectionId?: string;
  limit?: number;
  offset?: number;
}

export interface ClauseRepository {
  create(tenantId: TenantId, input: PolicyClauseCreateInput): Promise<PolicyClause>;
  findById(tenantId: TenantId, id: string): Promise<PolicyClause | null>;
  findByTenant(tenantId: TenantId, filters?: ClauseFilters): Promise<PolicyClause[]>;
  findBySourceDocument(tenantId: TenantId, sourceDocumentId: string): Promise<PolicyClause[]>;
  findByStatus(tenantId: TenantId, status: ClauseStatus): Promise<PolicyClause[]>;
  update(tenantId: TenantId, id: string, input: Partial<PolicyClauseCreateInput>): Promise<PolicyClause | null>;
}
