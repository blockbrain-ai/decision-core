/**
 * GET /policy — Query policy rules with optional filters.
 */

import type { TenantId } from '../../../contracts/common.contracts.js';
import type { HttpServerDeps } from '../types.js';

export interface PolicyQuery {
  policyType?: string;
  riskClass?: string;
  enforcementPoint?: string;
  enabled?: string;
  limit?: string;
  offset?: string;
}

export async function handlePolicy(
  query: PolicyQuery,
  deps: HttpServerDeps,
): Promise<{ status: number; data: unknown }> {
  const tenantId = deps.tenantId as TenantId;

  const rules = await deps.policyRuleRepo.findAll(tenantId, {
    policyType: query.policyType,
    riskClass: query.riskClass,
    enforcementPoint: query.enforcementPoint,
    enabled: query.enabled === undefined ? undefined : query.enabled === 'true',
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    offset: query.offset ? parseInt(query.offset, 10) : undefined,
  });

  return { status: 200, data: { status: 'ok', data: { rules, count: rules.length } } };
}
