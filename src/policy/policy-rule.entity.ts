/**
 * Policy Rule Entity
 *
 * Domain logic for evaluating a single policy rule against a context.
 * Determines whether a rule applies and what verdict it produces.
 */

import type { PolicyRule, PolicyContext, VerdictResult } from '../contracts/policy.contracts.js';
import { globMatches } from './glob-matcher.js';

export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  verdict: VerdictResult;
  reason: string;
  applies: boolean;
}

export function ruleAppliesToAction(rule: PolicyRule, actionType: string): boolean {
  return globMatches(rule.actionTypePattern, actionType);
}

export function ruleAppliesToEnforcementPoint(rule: PolicyRule, enforcementPoint: string): boolean {
  return rule.enforcementPoint === enforcementPoint;
}

export function evaluateRule(rule: PolicyRule, context: PolicyContext): RuleEvaluation {
  if (!rule.enabled) {
    return { ruleId: rule.id, ruleName: rule.name, verdict: 'allow', reason: 'Rule disabled', applies: false };
  }

  if (!ruleAppliesToAction(rule, context.actionType)) {
    return { ruleId: rule.id, ruleName: rule.name, verdict: 'allow', reason: 'Action type does not match', applies: false };
  }

  if (!ruleAppliesToEnforcementPoint(rule, context.enforcementPoint)) {
    return { ruleId: rule.id, ruleName: rule.name, verdict: 'allow', reason: 'Enforcement point does not match', applies: false };
  }

  // Role check — `requiredRoles` is a SCOPING predicate (which callers this rule
  // is about), NOT an authentication gate. Check it before thresholds so a
  // role-scoped limit cannot deny/approve callers outside that role.
  if (rule.requiredRoles && rule.requiredRoles.length > 0) {
    if (!context.callerRoles || context.callerRoles.length === 0) {
      // Caller has no roles — role-scoped rule does not apply to them (it is scoped
      // away, not satisfied). Backstopped by deny-unknown for unmatched actions.
      return { ruleId: rule.id, ruleName: rule.name, verdict: 'allow', reason: 'Caller has no roles — role-restricted rule skipped', applies: false };
    }

    const mode = rule.roleMatchMode ?? 'any';
    const hasRequiredRoles = mode === 'all'
      ? rule.requiredRoles.every((r) => context.callerRoles!.includes(r))
      : rule.requiredRoles.some((r) => context.callerRoles!.includes(r));

    if (!hasRequiredRoles) {
      // Caller lacks required roles — rule does not apply to them
      return { ruleId: rule.id, ruleName: rule.name, verdict: 'allow', reason: `Caller lacks required roles [${rule.requiredRoles.join(', ')}]`, applies: false };
    }
  }

  // Financial impact check
  if (rule.maxAmountUsd !== undefined && context.financialImpact !== undefined) {
    if (context.financialImpact > rule.maxAmountUsd) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        verdict: rule.requireApproval ? 'approve_required' : 'deny',
        reason: `Financial impact $${context.financialImpact} exceeds limit $${rule.maxAmountUsd}`,
        applies: true,
      };
    }
  }

  // Data quality check
  if (rule.minDataQuality !== undefined && context.dataQualityScore !== undefined) {
    if (context.dataQualityScore < rule.minDataQuality) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        verdict: rule.requireApproval ? 'approve_required' : 'deny',
        reason: `Data quality ${context.dataQualityScore} below minimum ${rule.minDataQuality}`,
        applies: true,
      };
    }
  }

  // Confidence check
  if (rule.minConfidence !== undefined && context.confidence !== undefined) {
    if (context.confidence < rule.minConfidence) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        verdict: rule.requireApproval ? 'approve_required' : 'deny',
        reason: `Confidence ${context.confidence} below minimum ${rule.minConfidence}`,
        applies: true,
      };
    }
  }

  // Time window check
  if (rule.timeWindowStart && rule.timeWindowEnd) {
    const now = new Date();
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    if (currentTime < rule.timeWindowStart || currentTime > rule.timeWindowEnd) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        verdict: 'deny',
        reason: `Outside allowed time window ${rule.timeWindowStart}-${rule.timeWindowEnd}`,
        applies: true,
      };
    }
  }

  // If rule requires approval and no threshold was violated, it still requires approval
  if (rule.requireApproval) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      verdict: 'approve_required',
      reason: `Rule "${rule.name}" requires approval`,
      applies: true,
    };
  }

  // Use defaultVerdict if set (enables unconditional deny/approve_required rules)
  const verdict = rule.defaultVerdict ?? 'allow';
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    verdict,
    reason: verdict === 'allow'
      ? `Rule "${rule.name}" allows action`
      : `Rule "${rule.name}" ${verdict === 'deny' ? 'denies' : 'requires approval for'} action`,
    applies: true,
  };
}
