/**
 * In-Memory Approval Repository
 *
 * Map-based implementation with tenant isolation (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { ApprovalRequest, ApprovalCreateInput, ApprovalFilters } from '../../contracts/approval.contracts.js';
import type { ApprovalRepository } from '../interfaces/approval.repository.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

export class InMemoryApprovalRepository implements ApprovalRepository {
  private store = new Map<string, Map<string, ApprovalRequest>>();

  private getTenantStore(tenantId: TenantId): Map<string, ApprovalRequest> {
    let tenant = this.store.get(tenantId);
    if (!tenant) {
      tenant = new Map();
      this.store.set(tenantId, tenant);
    }
    return tenant;
  }

  async create(tenantId: TenantId, input: ApprovalCreateInput): Promise<ApprovalRequest> {
    const now = new Date().toISOString();
    const id = generateUuidV7();
    const approval: ApprovalRequest = {
      ...input,
      id,
      tenantId,
      auditHash: hashCanonicalJson({ id, ...input, tenantId }),
      createdAt: now,
      updatedAt: now,
    };
    this.getTenantStore(tenantId).set(approval.id, approval);
    return approval;
  }

  async findById(tenantId: TenantId, id: string): Promise<ApprovalRequest | null> {
    return this.getTenantStore(tenantId).get(id) ?? null;
  }

  async findAll(tenantId: TenantId, filters?: ApprovalFilters): Promise<ApprovalRequest[]> {
    let records = Array.from(this.getTenantStore(tenantId).values());

    if (filters) {
      if (filters.status) records = records.filter((r) => filters.status!.includes(r.status));
      if (filters.priority) records = records.filter((r) => filters.priority!.includes(r.priority));
      if (filters.riskClass) records = records.filter((r) => r.riskClass === filters.riskClass);
      if (filters.from) {
        const from = filters.from;
        records = records.filter((r) => r.createdAt >= from);
      }
      if (filters.to) {
        const to = filters.to;
        records = records.filter((r) => r.createdAt <= to);
      }
      if (filters.offset) records = records.slice(filters.offset);
      if (filters.limit) records = records.slice(0, filters.limit);
    }

    return records;
  }

  async updateStatus(
    tenantId: TenantId,
    id: string,
    status: string,
    resolution?: { resolvedBy?: string; resolvedAt?: string; resolutionNotes?: string },
  ): Promise<ApprovalRequest | null> {
    const store = this.getTenantStore(tenantId);
    const existing = store.get(id);
    if (!existing) return null;

    const updated: ApprovalRequest = {
      ...existing,
      status: status as ApprovalRequest['status'],
      resolvedBy: resolution?.resolvedBy,
      resolvedAt: resolution?.resolvedAt ?? new Date().toISOString(),
      resolutionNotes: resolution?.resolutionNotes,
      updatedAt: new Date().toISOString(),
    };
    store.set(id, updated);
    return updated;
  }

  async count(tenantId: TenantId, filters?: ApprovalFilters): Promise<number> {
    const all = await this.findAll(tenantId, filters ? { ...filters, limit: undefined, offset: undefined } : undefined);
    return all.length;
  }
}
