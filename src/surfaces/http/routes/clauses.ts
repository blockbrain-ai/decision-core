/**
 * GET /clauses — List all policy clauses (rules) for the tenant.
 */

import type { TenantId } from '../../../contracts/common.contracts.js';
import type { HttpServerDeps } from '../types.js';

export interface ClausesQuery {
  limit?: string;
  offset?: string;
}

export async function handleClauses(
  query: ClausesQuery,
  deps: HttpServerDeps,
): Promise<{ status: number; data: unknown }> {
  const tenantId = deps.tenantId as TenantId;

  const clauses = await deps.policyRuleRepo.findAll(tenantId, {
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    offset: query.offset ? parseInt(query.offset, 10) : undefined,
  });

  return { status: 200, data: { status: 'ok', data: { clauses, count: clauses.length } } };
}
