/**
 * Event Repository Interface
 *
 * Event storage for the audit trail, scoped by tenantId (D2).
 */

import type { TenantId } from '../../contracts/common.contracts.js';

export interface DomainEvent {
  id: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  timestamp: string;
  correlationId: string;
  tenantId: string;
}

export interface EventFilters {
  type?: string;
  source?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface EventRepository {
  append(tenantId: TenantId, event: DomainEvent): Promise<DomainEvent>;
  findById(tenantId: TenantId, id: string): Promise<DomainEvent | null>;
  findAll(tenantId: TenantId, filters?: EventFilters): Promise<DomainEvent[]>;
  findByCorrelationId(tenantId: TenantId, correlationId: string): Promise<DomainEvent[]>;
  count(tenantId: TenantId, filters?: EventFilters): Promise<number>;
}
