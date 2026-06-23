/**
 * POST /evaluate — Evaluate policy rules against an action.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../../../utils/logger.js';
import type { HttpServerDeps } from '../types.js';

const logger = createLogger('http-evaluate');

export interface EvaluateBody {
  surfaceId: string;
  action: string;
  context?: Record<string, unknown>;
}

export async function handleEvaluate(
  body: EvaluateBody,
  deps: HttpServerDeps,
): Promise<{ status: number; data: unknown }> {
  if (!body.surfaceId || !body.action) {
    return { status: 400, data: { error: 'Missing required fields: surfaceId, action', code: 'INVALID_REQUEST' } };
  }

  const correlationId = randomUUID();

  const result = await deps.policyEvaluator.evaluate(
    deps.tenantId,
    body.surfaceId,
    body.action,
    body.context,
  );

  if (deps.evidenceSink) {
    // Fire-and-forget: never block the policy verdict response on evidence recording.
    deps.evidenceSink.recordEvaluation({
      tenantId: deps.tenantId,
      surfaceId: body.surfaceId,
      host: body.context?.host as string ?? body.surfaceId,
      agentId: body.context?.agentId as string,
      action: body.action,
      verdict: result.verdict,
      correlationId,
      matchedPolicies: result.matchedPolicies as unknown as Array<Record<string, unknown>>,
      context: body.context,
    }).catch((err) => {
      logger.error({ err, correlationId }, 'evidence sink recording failed — verdict unchanged');
    });
  }

  return { status: 200, data: { status: 'ok', data: { ...result, correlationId } } };
}
