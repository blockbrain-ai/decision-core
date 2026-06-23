export { globToRegex, globMatches } from './glob-matcher.js';
export { AUTONOMY_MODES, resolveAutonomyMode, applyAutonomyEffect } from './autonomy-level.js';
export type { AutonomyMode, AutonomyEffect } from './autonomy-level.js';
export { POLICY_EVENTS } from './policy.events.js';
export type { PolicyEventType } from './policy.events.js';
export { evaluateRule, ruleAppliesToAction, ruleAppliesToEnforcementPoint } from './policy-rule.entity.js';
export type { RuleEvaluation } from './policy-rule.entity.js';
export type { EvaluationRequest, EnforcementResult, EnforcementOptions } from './policy-context.types.js';
export { PolicyAuditService } from './policy-audit.service.js';
export type { AuditEntryInput } from './policy-audit.service.js';
export { PolicyDecisionPoint, arbitrate } from './policy-decision-point.js';
export { PolicyEnforcementPoint } from './policy-enforcement-point.js';

// Conflict Analysis (new in production-hardening)
export {
  analyzePolicyPack,
  hasConflicts,
} from './analysis/conflict-detector.js';
export type {
  ConflictReport,
  PolicyConflict,
  ConflictAnalysisOptions,
} from './analysis/types.js';
