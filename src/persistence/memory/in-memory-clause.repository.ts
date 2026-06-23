/**
 * In-Memory Clause Repository
 *
 * Map-based implementation with tenant isolation (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type {
  PolicyClause,
  PolicyClauseCreateInput,
  ClauseStatus,
} from '../../contracts/clause.contracts.js';
import type { ClauseRepository, ClauseFilters } from '../interfaces/clause.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';
import { computeClauseHash } from '../../knowledge/clauses/clause.entity.js';

export class InMemoryClauseRepository implements ClauseRepository {
  private store = new Map<string, Map<string, PolicyClause>>();

  private getTenantStore(tenantId: TenantId): Map<string, PolicyClause> {
    let tenant = this.store.get(tenantId);
    if (!tenant) {
      tenant = new Map();
      this.store.set(tenantId, tenant);
    }
    return tenant;
  }

  async create(tenantId: TenantId, input: PolicyClauseCreateInput): Promise<PolicyClause> {
    const now = new Date().toISOString();
    const id = generateUuidV7();
    const normalizedHash = computeClauseHash(input.text);
    const clause: PolicyClause = {
      ...input,
      id,
      tenantId,
      normalizedHash,
      auditHash: hashCanonicalJson({ id, ...input, tenantId, normalizedHash }),
      createdAt: now,
      updatedAt: now,
    };
    this.getTenantStore(tenantId).set(id, clause);
    return clause;
  }

  async findById(tenantId: TenantId, id: string): Promise<PolicyClause | null> {
    return this.getTenantStore(tenantId).get(id) ?? null;
  }

  async findByTenant(tenantId: TenantId, filters?: ClauseFilters): Promise<PolicyClause[]> {
    let records = Array.from(this.getTenantStore(tenantId).values());

    if (filters) {
      if (filters.status) records = records.filter((r) => r.status === filters.status);
      if (filters.clauseType) records = records.filter((r) => r.clauseType === filters.clauseType);
      if (filters.sourceDocumentId) records = records.filter((r) => r.sourceDocumentId === filters.sourceDocumentId);
      if (filters.sectionId) records = records.filter((r) => r.sectionId === filters.sectionId);
      if (filters.offset) records = records.slice(filters.offset);
      if (filters.limit) records = records.slice(0, filters.limit);
    }

    return records;
  }

  async findBySourceDocument(tenantId: TenantId, sourceDocumentId: string): Promise<PolicyClause[]> {
    return Array.from(this.getTenantStore(tenantId).values())
      .filter((r) => r.sourceDocumentId === sourceDocumentId);
  }

  async findByStatus(tenantId: TenantId, status: ClauseStatus): Promise<PolicyClause[]> {
    return Array.from(this.getTenantStore(tenantId).values())
      .filter((r) => r.status === status);
  }

  async update(
    tenantId: TenantId,
    id: string,
    input: Partial<PolicyClauseCreateInput>,
  ): Promise<PolicyClause | null> {
    const store = this.getTenantStore(tenantId);
    const existing = store.get(id);
    if (!existing) return null;

    const updated: PolicyClause = {
      ...existing,
      ...input,
      normalizedHash: input.text ? computeClauseHash(input.text) : existing.normalizedHash,
      updatedAt: new Date().toISOString(),
    };
    updated.auditHash = hashCanonicalJson({ ...updated });
    store.set(id, updated);
    return updated;
  }
}
