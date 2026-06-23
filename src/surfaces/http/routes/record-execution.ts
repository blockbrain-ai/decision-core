/**
 * POST /record-execution — Record post-tool execution evidence.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../../../utils/logger.js';
import type { HttpServerDeps } from '../types.js';

const logger = createLogger('http-record-execution');

export interface RecordExecutionBody {
  surfaceId?: string;
  surface?: string;
  toolName: string;
  result?: Record<string, unknown>;
  timingMs?: number;
  timing_ms?: number;
  correlationId?: string;
}

export async function handleRecordExecution(
  body: RecordExecutionBody,
  deps: HttpServerDeps,
  agentId?: string,
): Promise<{ status: number; data: unknown }> {
  if (!body.toolName) {
    return { status: 400, data: { error: 'Missing required field: toolName', code: 'INVALID_REQUEST' } };
  }

  const surfaceId = body.surfaceId ?? body.surface ?? 'unknown';
  const correlationId = body.correlationId ?? randomUUID();
  const timingMs = body.timingMs ?? body.timing_ms;

  if (!deps.evidenceSink) {
    return { status: 200, data: { status: 'ok', data: { recorded: false, reason: 'no evidence sink configured' } } };
  }

  try {
    await deps.evidenceSink.recordExecution({
      tenantId: deps.tenantId,
      surfaceId,
      host: surfaceId,
      agentId,
      action: body.toolName,
      correlationId,
      result: body.result,
      timingMs,
    });
  } catch (err) {
    logger.error({ err, correlationId }, 'execution evidence recording failed');
    return { status: 200, data: { status: 'ok', data: { recorded: false, reason: 'sink error' } } };
  }

  return { status: 200, data: { status: 'ok', data: { recorded: true, correlationId } } };
}
