/**
 * In-Memory Event Repository
 *
 * Append-only Map-based implementation with tenant isolation (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { DomainEvent, EventFilters, EventRepository } from '../interfaces/event.repository.js';

export class InMemoryEventRepository implements EventRepository {
  private store = new Map<string, Map<string, DomainEvent>>();

  private getTenantStore(tenantId: TenantId): Map<string, DomainEvent> {
    let tenant = this.store.get(tenantId);
    if (!tenant) {
      tenant = new Map();
      this.store.set(tenantId, tenant);
    }
    return tenant;
  }

  async append(tenantId: TenantId, event: DomainEvent): Promise<DomainEvent> {
    this.getTenantStore(tenantId).set(event.id, event);
    return event;
  }

  async findById(tenantId: TenantId, id: string): Promise<DomainEvent | null> {
    return this.getTenantStore(tenantId).get(id) ?? null;
  }

  async findAll(tenantId: TenantId, filters?: EventFilters): Promise<DomainEvent[]> {
    let events = Array.from(this.getTenantStore(tenantId).values());

    if (filters) {
      if (filters.type) events = events.filter((e) => e.type === filters.type);
      if (filters.source) events = events.filter((e) => e.source === filters.source);
      if (filters.correlationId) events = events.filter((e) => e.correlationId === filters.correlationId);
      if (filters.from) {
        const from = filters.from;
        events = events.filter((e) => e.timestamp >= from);
      }
      if (filters.to) {
        const to = filters.to;
        events = events.filter((e) => e.timestamp <= to);
      }
      if (filters.offset) events = events.slice(filters.offset);
      if (filters.limit) events = events.slice(0, filters.limit);
    }

    return events;
  }

  async findByCorrelationId(tenantId: TenantId, correlationId: string): Promise<DomainEvent[]> {
    return Array.from(this.getTenantStore(tenantId).values())
      .filter((e) => e.correlationId === correlationId);
  }

  async count(tenantId: TenantId, filters?: EventFilters): Promise<number> {
    const all = await this.findAll(tenantId, filters ? { ...filters, limit: undefined, offset: undefined } : undefined);
    return all.length;
  }
}
