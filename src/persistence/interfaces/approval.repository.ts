/**
 * Approval Repository Interface
 *
 * Approval lifecycle storage, scoped by tenantId (D2).
 */

import type { ApprovalRequest, ApprovalCreateInput, ApprovalFilters } from '../../contracts/approval.contracts.js';
import type { TenantId } from '../../contracts/common.contracts.js';

export interface ApprovalRepository {
  create(tenantId: TenantId, input: ApprovalCreateInput): Promise<ApprovalRequest>;
  findById(tenantId: TenantId, id: string): Promise<ApprovalRequest | null>;
  findAll(tenantId: TenantId, filters?: ApprovalFilters): Promise<ApprovalRequest[]>;
  updateStatus(tenantId: TenantId, id: string, status: string, resolution?: { resolvedBy?: string; resolvedAt?: string; resolutionNotes?: string }): Promise<ApprovalRequest | null>;
  count(tenantId: TenantId, filters?: ApprovalFilters): Promise<number>;
}
