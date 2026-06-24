import type { ApprovalRepository } from '../persistence/interfaces/approval.repository.js';
import type { ApprovalRequest } from '../contracts/approval.contracts.js';
import type { TenantId } from '../contracts/common.contracts.js';
import { checkSeparationOfDuties } from './approval-routing.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('resolve-approval');

export interface ResolveApprovalInput {
  tenantId: TenantId;
  approvalId: string;
  decision: 'approved' | 'rejected';
  /** The authenticated identity resolving the approval (NOT body-supplied at the surface). */
  resolvedBy: string;
  /** Roles of the resolver, from the server-side registry — used for break-glass. */
  resolverRoles: string[];
  resolutionNotes?: string;
  /** Break-glass self-approval: CEO role + explicit reason + a valid future expiry. */
  breakGlass?: { reason: string; expiresAt: string };
}

export type ResolveApprovalResult =
  | { ok: true; request: ApprovalRequest }
  | { ok: false; code: 'not_found' | 'already_resolved' | 'separation_of_duties'; reason: string };

/**
 * The single enforcement point for resolving an approval request. **Separation of
 * duties is enforced here**: the requester may not approve their own request
 * (self-approval) unless the break-glass path (CEO role + reason + future expiry)
 * is taken. A self-*reject* is always allowed — you can withdraw or deny your own
 * request; SoD only guards self-grant.
 *
 * Every approval-resolution surface (HTTP/MCP/CLI/SDK) must route through this so
 * SoD cannot be bypassed by calling the repository's updateStatus() directly.
 */
export async function resolveApprovalRequest(
  repo: ApprovalRepository,
  input: ResolveApprovalInput,
): Promise<ResolveApprovalResult> {
  const existing = await repo.findById(input.tenantId, input.approvalId);
  if (!existing) {
    return { ok: false, code: 'not_found', reason: `Approval ${input.approvalId} not found` };
  }
  if (existing.status !== 'pending') {
    return { ok: false, code: 'already_resolved', reason: `Approval already ${existing.status}` };
  }

  // SoD applies only to APPROVE — a self-reject is harmless.
  if (input.decision === 'approved') {
    const sod = checkSeparationOfDuties(
      existing.requestedBy,
      input.resolvedBy,
      input.resolverRoles,
      input.breakGlass,
    );
    if (!sod.allowed) {
      logger.warn(
        {
          approvalId: input.approvalId,
          requestedBy: existing.requestedBy,
          resolvedBy: input.resolvedBy,
          reason: sod.reason,
        },
        'Approval blocked by separation of duties',
      );
      return { ok: false, code: 'separation_of_duties', reason: sod.reason ?? 'Separation of duties violated' };
    }
  }

  const updated = await repo.updateStatus(input.tenantId, input.approvalId, input.decision, {
    resolvedBy: input.resolvedBy,
    resolvedAt: new Date().toISOString(),
    resolutionNotes: input.resolutionNotes,
  });
  if (!updated) {
    return { ok: false, code: 'not_found', reason: `Approval ${input.approvalId} vanished during update` };
  }
  return { ok: true, request: updated };
}
