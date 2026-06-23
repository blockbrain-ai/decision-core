/**
 * Decision Log Repository Interface
 *
 * Append-only decision log storage, scoped by tenantId (D2).
 */

import type { DecisionRecord, DecisionFilters } from '../../contracts/decision.contracts.js';
import type { TenantId } from '../../contracts/common.contracts.js';

export interface DecisionLogRepository {
  append(tenantId: TenantId, record: DecisionRecord): Promise<DecisionRecord>;
  findById(tenantId: TenantId, id: string): Promise<DecisionRecord | null>;
  findAll(tenantId: TenantId, filters?: DecisionFilters): Promise<DecisionRecord[]>;
  findByCorrelationId(tenantId: TenantId, correlationId: string): Promise<DecisionRecord[]>;
  count(tenantId: TenantId, filters?: DecisionFilters): Promise<number>;
}
