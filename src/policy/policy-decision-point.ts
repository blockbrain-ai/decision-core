/**
 * Policy Decision Point (PDP)
 *
 * Evaluates policy rules against a context and returns a verdict.
 *
 * SAFETY INVARIANT — deny-wins:
 *   If ANY applicable rule returns `deny`, the final verdict is `deny`
 *   regardless of other rules. `approve_required` beats `allow` but
 *   loses to `deny`.
 *
 * Verdict precedence: deny > approve_required > allow
 */

import type { TenantId, CorrelationId } from '../contracts/common.contracts.js';
import type { PolicyContext, PolicyVerdict, PolicyVerdictResult } from '../contracts/policy.contracts.js';
import type { PolicyRuleRepository } from '../persistence/interfaces/policy-rule.repository.js';
import type { EventService } from '../adapters/event-service.js';
import { evaluateRule } from './policy-rule.entity.js';
import { PolicyAuditService } from './policy-audit.service.js';
import { POLICY_EVENTS } from './policy.events.js';
import { generateUuidV7 } from '../utils/uuid-v7.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('policy-decision-point');

export class PolicyDecisionPoint {
  private readonly auditService: PolicyAuditService;

  constructor(
    private readonly ruleRepository: PolicyRuleRepository,
    private readonly eventService: EventService,
  ) {
    this.auditService = new PolicyAuditService(eventService);
  }

  async evaluate(
    tenantId: TenantId,
    context: PolicyContext,
    correlationId?: CorrelationId,
  ): Promise<PolicyVerdict> {
    const corrId = correlationId ?? (generateUuidV7() as CorrelationId);

    // Fetch all enabled rules for this tenant that match the action type
    const rules = await this.ruleRepository.findByActionType(tenantId, context.actionType);
    const enabledRules = rules.filter((r) => r.enabled);

    if (enabledRules.length === 0) {
      logger.debug({ tenantId, actionType: context.actionType }, 'No applicable rules — allowing');
      return { verdict: 'allow', matchedPolicies: [] };
    }

    // Sort by priority (higher priority first)
    const sorted = [...enabledRules].sort((a, b) => b.priority - a.priority);

    const matchedPolicies: PolicyVerdictResult[] = [];

    for (const rule of sorted) {
      const evaluation = evaluateRule(rule, context);

      if (!evaluation.applies) continue;

      matchedPolicies.push({
        ruleId: evaluation.ruleId,
        ruleName: evaluation.ruleName,
        verdict: evaluation.verdict,
        reason: evaluation.reason,
      });

      // Record audit for every applicable rule
      this.auditService.record({
        ruleId: evaluation.ruleId,
        ruleName: evaluation.ruleName,
        actionType: context.actionType,
        verdict: evaluation.verdict,
        reason: evaluation.reason,
        correlationId: corrId,
        tenantId,
      });
    }

    // Apply deny-wins arbitration
    const finalVerdict = arbitrate(matchedPolicies);

    // Emit appropriate event
    const eventType =
      finalVerdict === 'deny'
        ? POLICY_EVENTS.POLICY_DENIED
        : finalVerdict === 'approve_required'
          ? POLICY_EVENTS.POLICY_APPROVAL_REQUIRED
          : POLICY_EVENTS.POLICY_ALLOWED;

    this.eventService.emit({
      id: generateUuidV7(),
      type: eventType,
      source: 'policy-decision-point',
      payload: {
        actionType: context.actionType,
        verdict: finalVerdict,
        rulesEvaluated: matchedPolicies.length,
      },
      timestamp: new Date().toISOString(),
      correlationId: corrId,
      tenantId,
    });

    logger.info(
      { tenantId, actionType: context.actionType, verdict: finalVerdict, rulesMatched: matchedPolicies.length },
      'Policy evaluation complete',
    );

    return { verdict: finalVerdict, matchedPolicies };
  }

  getAuditService(): PolicyAuditService {
    return this.auditService;
  }
}

/**
 * Deny-wins arbitration.
 *
 * Precedence: deny > approve_required > allow
 * If no rules matched, default is allow.
 */
export function arbitrate(results: PolicyVerdictResult[]): PolicyVerdict['verdict'] {
  if (results.length === 0) return 'allow';

  const hasDeny = results.some((r) => r.verdict === 'deny');
  if (hasDeny) return 'deny';

  const hasApproveRequired = results.some((r) => r.verdict === 'approve_required');
  if (hasApproveRequired) return 'approve_required';

  return 'allow';
}
