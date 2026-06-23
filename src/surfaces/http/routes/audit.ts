/**
 * GET /audit — Query the decision audit trail.
 */

import type { TenantId } from '../../../contracts/common.contracts.js';
import type { HttpServerDeps } from '../types.js';

export interface AuditQuery {
  surface?: string;
  toolName?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

export async function handleAudit(
  query: AuditQuery,
  deps: HttpServerDeps,
): Promise<{ status: number; data: unknown }> {
  const tenantId = deps.tenantId as TenantId;

  const records = await deps.decisionLogRepo.findAll(tenantId, {
    surface: query.surface,
    toolName: query.toolName,
    status: query.status ? query.status.split(',') as Array<'generated' | 'blocked' | 'failed' | 'pending'> : undefined,
    from: query.from,
    to: query.to,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    offset: query.offset ? parseInt(query.offset, 10) : undefined,
  });

  return { status: 200, data: { status: 'ok', data: { records, count: records.length } } };
}
