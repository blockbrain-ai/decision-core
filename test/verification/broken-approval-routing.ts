/**
 * Broken Approval Routing — Allows self-approval without separation of duties.
 *
 * Mutation: checkSeparationOfDuties always returns allowed:true, even when
 * requestor === approver and no break-glass is provided.
 * When swapped in, SoD tests must fail because self-approval is never blocked.
 */

import type { SeparationOfDutiesCheck } from '../../src/approval/approval-routing.js';

/**
 * Always allows — no separation of duties enforcement.
 * Self-approval is permitted regardless of role or break-glass state.
 */
export function brokenCheckSeparationOfDuties(
  _requestedBy: string,
  _resolvedBy: string,
  _resolverRoles: string[],
  _breakGlass?: { reason: string; expiresAt: string },
): SeparationOfDutiesCheck {
  return { allowed: true };
}
