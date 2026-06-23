/**
 * Policy Enforcement Point (PEP)
 *
 * Wraps actions with stage-specific enforcement. The PEP:
 * 1. Asks the PDP for a verdict
 * 2. Applies autonomy level to determine blocking behavior
 * 3. Returns an EnforcementResult indicating whether the action may proceed
 *
 * Autonomy modes:
 * - strict:     deny and approve_required both block
 * - permissive: deny blocks, approve_required logged but allowed
 * - advisory:   everything logged, nothing blocks
 */

import type { TenantId, CorrelationId } from '../contracts/common.contracts.js';
import type { EnforcementPoint } from '../contracts/policy.contracts.js';
import type { EventService } from '../adapters/event-service.js';
import { PolicyDecisionPoint } from './policy-decision-point.js';
import { resolveAutonomyMode, applyAutonomyEffect } from './autonomy-level.js';
import type { EnforcementResult, EnforcementOptions } from './policy-context.types.js';
import { POLICY_EVENTS } from './policy.events.js';
import { generateUuidV7 } from '../utils/uuid-v7.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('policy-enforcement-point');

const DEFAULT_AUTONOMY_LEVEL = 0; // strict by default

export class PolicyEnforcementPoint {
  constructor(
    private readonly pdp: PolicyDecisionPoint,
    private readonly eventService: EventService,
  ) {}

  async enforce(
    tenantId: TenantId,
    stage: EnforcementPoint,
    actionType: string,
    options?: EnforcementOptions,
  ): Promise<EnforcementResult> {
    const correlationId = (options?.correlationId ?? generateUuidV7()) as CorrelationId;
    const autonomyLevel = options?.autonomyLevel ?? DEFAULT_AUTONOMY_LEVEL;
    const autonomyMode = resolveAutonomyMode(autonomyLevel);

    const verdict = await this.pdp.evaluate(
      tenantId,
      {
        enforcementPoint: stage,
        actionType,
        autonomyLevel,
        financialImpact: options?.financialImpact,
        dataQualityScore: options?.dataQualityScore,
        confidence: options?.confidence,
      },
      correlationId,
    );

    const effect = applyAutonomyEffect(verdict.verdict, autonomyMode);

    const result: EnforcementResult = {
      allowed: !effect.shouldBlock,
      verdict: effect.effectiveVerdict,
      autonomyMode,
      matchedPolicies: verdict.matchedPolicies,
      explanation: buildExplanation(verdict.verdict, effect.effectiveVerdict, autonomyMode, verdict.matchedPolicies.length),
      correlationId,
    };

    const eventType = result.allowed
      ? POLICY_EVENTS.POLICY_ENFORCED
      : POLICY_EVENTS.POLICY_BLOCKED;

    this.eventService.emit({
      id: generateUuidV7(),
      type: eventType,
      source: 'policy-enforcement-point',
      payload: {
        stage,
        actionType,
        allowed: result.allowed,
        verdict: result.verdict,
        autonomyMode,
        rulesMatched: verdict.matchedPolicies.length,
      },
      timestamp: new Date().toISOString(),
      correlationId,
      tenantId,
    });

    logger.info(
      { tenantId, stage, actionType, allowed: result.allowed, verdict: result.verdict, autonomyMode },
      'Policy enforcement complete',
    );

    return result;
  }
}

function buildExplanation(
  rawVerdict: string,
  effectiveVerdict: string,
  mode: string,
  ruleCount: number,
): string {
  if (ruleCount === 0) {
    return 'No applicable policy rules — action allowed';
  }

  if (rawVerdict !== effectiveVerdict) {
    return `Raw verdict "${rawVerdict}" adjusted to "${effectiveVerdict}" under ${mode} autonomy mode (${ruleCount} rule(s) evaluated)`;
  }

  return `Verdict "${effectiveVerdict}" from ${ruleCount} rule(s) under ${mode} autonomy mode`;
}
