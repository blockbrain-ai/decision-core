/**
 * Enforcement Guard
 *
 * Runtime filter ensuring only active, temporally-valid clauses
 * participate in enforcement queries. Draft, approved-but-not-active,
 * superseded, and future-dated clauses are excluded.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';
import { isEnforceable } from './clause.entity.js';

/**
 * Filter an array of clauses to only those that are enforceable now.
 */
export function filterEnforceable(
  clauses: PolicyClause[],
  asOf?: string,
): PolicyClause[] {
  return clauses.filter((clause) => isEnforceable(clause, asOf));
}

/**
 * Query the repository for active clauses and apply the enforcement guard.
 * This is the ONLY path enforcement code should use to obtain clauses.
 */
export async function getEnforceableClauses(
  repository: ClauseRepository,
  tenantId: TenantId,
  asOf?: string,
): Promise<PolicyClause[]> {
  const activeClauses = await repository.findByStatus(tenantId, 'active');
  return filterEnforceable(activeClauses, asOf);
}
