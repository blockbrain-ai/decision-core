/**
 * In-Memory Decision Log Repository
 *
 * Append-only Map-based implementation with tenant isolation (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { DecisionRecord, DecisionFilters } from '../../contracts/decision.contracts.js';
import type { DecisionLogRepository } from '../interfaces/decision-log.repository.js';

export class InMemoryDecisionLogRepository implements DecisionLogRepository {
  private store = new Map<string, Map<string, DecisionRecord>>();

  private getTenantStore(tenantId: TenantId): Map<string, DecisionRecord> {
    let tenant = this.store.get(tenantId);
    if (!tenant) {
      tenant = new Map();
      this.store.set(tenantId, tenant);
    }
    return tenant;
  }

  async append(tenantId: TenantId, record: DecisionRecord): Promise<DecisionRecord> {
    this.getTenantStore(tenantId).set(record.id, record);
    return record;
  }

  async findById(tenantId: TenantId, id: string): Promise<DecisionRecord | null> {
    return this.getTenantStore(tenantId).get(id) ?? null;
  }

  async findAll(tenantId: TenantId, filters?: DecisionFilters): Promise<DecisionRecord[]> {
    let records = Array.from(this.getTenantStore(tenantId).values());

    if (filters) {
      if (filters.surface) records = records.filter((r) => r.surface === filters.surface);
      if (filters.toolName) records = records.filter((r) => r.toolName === filters.toolName);
      if (filters.status) records = records.filter((r) => filters.status!.includes(r.status));
      if (filters.minConfidence !== undefined) records = records.filter((r) => r.confidence >= filters.minConfidence!);
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

  async findByCorrelationId(tenantId: TenantId, correlationId: string): Promise<DecisionRecord[]> {
    return Array.from(this.getTenantStore(tenantId).values())
      .filter((r) => r.correlationId === correlationId);
  }

  async count(tenantId: TenantId, filters?: DecisionFilters): Promise<number> {
    const all = await this.findAll(tenantId, filters ? { ...filters, limit: undefined, offset: undefined } : undefined);
    return all.length;
  }
}
