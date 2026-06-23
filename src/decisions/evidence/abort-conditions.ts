/**
 * Decision Abort Conditions
 *
 * Determines whether a decision should be aborted based on
 * pipeline state. Hard aborts prevent any decision from being
 * produced. Soft aborts mark the decision as safe-blocked.
 */

export type AbortSeverity = 'hard' | 'soft';

export interface AbortCondition {
  severity: AbortSeverity;
  reason: string;
  code: string;
}

export interface AbortCheckInput {
  policyVerdict: string;
  routeResolved: boolean;
  modelRequired: boolean;
  modelAvailable: boolean;
  qualityGateStatus: string;
}

/**
 * Check for conditions that should abort the decision pipeline.
 */
export function checkAbortConditions(input: AbortCheckInput): AbortCondition[] {
  const conditions: AbortCondition[] = [];

  if (input.policyVerdict === 'deny') {
    conditions.push({
      severity: 'hard',
      reason: 'Policy denied this action',
      code: 'POLICY_DENY',
    });
  }

  if (input.qualityGateStatus === 'fail') {
    conditions.push({
      severity: 'hard',
      reason: 'Quality gate failed — required entities below threshold',
      code: 'QUALITY_GATE_FAIL',
    });
  }

  if (input.modelRequired && !input.modelAvailable) {
    conditions.push({
      severity: 'soft',
      reason: 'Model gateway required but not available — safe block',
      code: 'MODEL_UNAVAILABLE',
    });
  }

  if (!input.routeResolved) {
    conditions.push({
      severity: 'soft',
      reason: 'No route resolved for surface — safe block',
      code: 'NO_ROUTE',
    });
  }

  return conditions;
}

/**
 * Check if any hard abort conditions exist.
 */
export function hasHardAbort(conditions: AbortCondition[]): boolean {
  return conditions.some((c) => c.severity === 'hard');
}

/**
 * Check if any soft abort conditions exist (no hard aborts).
 */
export function hasSoftAbort(conditions: AbortCondition[]): boolean {
  return !hasHardAbort(conditions) && conditions.some((c) => c.severity === 'soft');
}
