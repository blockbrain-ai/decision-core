/**
 * PolicyClause Domain Entity
 *
 * Domain logic for clause hash computation and status transitions.
 */

import type { ClauseStatus, PolicyClause } from '../../contracts/clause.contracts.js';
import { hashNormalizedText } from '../../utils/audit-hash.js';

/**
 * Valid status transitions for a PolicyClause.
 * draft → approved → active → superseded
 * draft → superseded (fast-track replacement)
 */
const VALID_TRANSITIONS: Record<ClauseStatus, ClauseStatus[]> = {
  draft: ['approved', 'superseded'],
  approved: ['active', 'superseded'],
  active: ['superseded'],
  superseded: [],
};

/**
 * Compute the normalized hash for a clause's text.
 * Uses SHA-256 of line-normalized text for tamper detection.
 */
export function computeClauseHash(text: string): string {
  return hashNormalizedText(text);
}

/**
 * Determine if a status transition is valid.
 */
export function isValidTransition(from: ClauseStatus, to: ClauseStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Attempt a status transition on a clause. Returns the updated clause
 * or null if the transition is invalid.
 */
export function transitionStatus(
  clause: PolicyClause,
  newStatus: ClauseStatus,
): PolicyClause | null {
  if (!isValidTransition(clause.status, newStatus)) {
    return null;
  }
  return {
    ...clause,
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Check whether a clause is enforceable (active and not expired).
 */
export function isEnforceable(clause: PolicyClause, asOf?: string): boolean {
  if (clause.status !== 'active') return false;

  const now = asOf ?? new Date().toISOString();

  if (clause.effectiveDate && clause.effectiveDate > now) return false;
  if (clause.expiryDate && clause.expiryDate <= now) return false;

  return true;
}
