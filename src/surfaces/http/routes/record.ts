/**
 * POST /record — Record/query decision audit records.
 *
 * When called with a correlationId, returns decision records for that correlation.
 * Otherwise, returns all records matching the given filters.
 */

import type { TenantId } from '../../../contracts/common.contracts.js';
import type { HttpServerDeps } from '../types.js';


export interface RecordBody {
  correlationId?: string;
  surface?: string;
  toolName?: string;
  status?: string[];
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function handleRecord(
  body: RecordBody,
  deps: HttpServerDeps,
): Promise<{ status: number; data: unknown }> {
  const tenantId = deps.tenantId as TenantId;

  if (body.correlationId) {
    const records = await deps.decisionLogRepo.findByCorrelationId(tenantId, body.correlationId);
    return { status: 200, data: { status: 'ok', data: { correlationId: body.correlationId, records } } };
  }

  const records = await deps.decisionLogRepo.findAll(tenantId, {
    surface: body.surface,
    toolName: body.toolName,
    status: body.status as Array<'generated' | 'blocked' | 'failed' | 'pending'> | undefined,
    from: body.from,
    to: body.to,
    limit: body.limit,
    offset: body.offset,
  });

  return { status: 200, data: { status: 'ok', data: { records, count: records.length } } };
}
