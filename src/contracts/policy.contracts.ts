/**
 * Policy Contract Types
 *
 * Defines types for the policy decision point (PDP),
 * enforcement points, verdicts, and policy rules.
 */

import { z } from 'zod';
import { RiskClassSchema } from './common.contracts.js';

// ===========================================================================
// Enforcement Point
// ===========================================================================

export const ENFORCEMENT_POINTS = ['pre_decision', 'action_dispatch', 'post_execution'] as const;
export const EnforcementPointSchema = z.enum(ENFORCEMENT_POINTS);
export type EnforcementPoint = z.infer<typeof EnforcementPointSchema>;

// ===========================================================================
// Policy Type
// ===========================================================================

export const POLICY_TYPES = ['safety', 'compliance', 'business', 'resource', 'quality'] as const;
export const PolicyTypeSchema = z.enum(POLICY_TYPES);
export type PolicyType = z.infer<typeof PolicyTypeSchema>;

// ===========================================================================
// Verdict
// ===========================================================================

export const VERDICT_RESULTS = ['allow', 'deny', 'approve_required'] as const;
export const VerdictResultSchema = z.enum(VERDICT_RESULTS);
export type VerdictResult = z.infer<typeof VerdictResultSchema>;

export const ENFORCEMENT_MODES = ['strict', 'advisory'] as const;
export const EnforcementModeSchema = z.enum(ENFORCEMENT_MODES);
export type EnforcementMode = z.infer<typeof EnforcementModeSchema>;

// ===========================================================================
// Autonomy Level
// ===========================================================================

export const AutonomyLevelSchema = z.number().int().min(0).max(5);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

// ===========================================================================
// Policy Rule
// ===========================================================================

export const PolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  actionTypePattern: z.string(),
  riskClass: RiskClassSchema,
  enforcementPoint: EnforcementPointSchema,
  policyType: PolicyTypeSchema,
  priority: z.number().int(),
  maxAmountUsd: z.number().optional(),
  maxCountPerDay: z.number().int().optional(),
  cooldownMinutes: z.number().int().optional(),
  timeWindowStart: z.string().optional(),
  timeWindowEnd: z.string().optional(),
  minDataQuality: z.number().optional(),
  minConfidence: z.number().optional(),
  requiredConstraints: z.array(z.string()),
  requireApproval: z.boolean(),
  defaultVerdict: VerdictResultSchema.optional(),
  requiredRoles: z.array(z.string()).optional(),
  roleMatchMode: z.enum(['any', 'all']).default('any').optional(),
  approverRole: z.string().optional(),
  enabled: z.boolean(),
  tenantId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

// ===========================================================================
// Policy Rule Create Input
// ===========================================================================

export const PolicyRuleCreateInputSchema = PolicyRuleSchema.omit({
  id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  requiredConstraints: z.array(z.string()).optional(),
});
export type PolicyRuleCreateInput = z.infer<typeof PolicyRuleCreateInputSchema>;

// ===========================================================================
// Policy Evaluation Context
// ===========================================================================

export const PolicyContextSchema = z.object({
  enforcementPoint: z.string(),
  actionType: z.string(),
  financialImpact: z.number().optional(),
  dataQualityScore: z.number().optional(),
  confidence: z.number().optional(),
  autonomyLevel: AutonomyLevelSchema.optional(),
  agentId: z.string().optional(),
  callerRoles: z.array(z.string()).optional(),
});
export type PolicyContext = z.infer<typeof PolicyContextSchema>;

// ===========================================================================
// Policy Verdict
// ===========================================================================

export const PolicyVerdictResultSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  verdict: VerdictResultSchema,
  reason: z.string(),
});
export type PolicyVerdictResult = z.infer<typeof PolicyVerdictResultSchema>;

export const PolicyVerdictSchema = z.object({
  verdict: VerdictResultSchema,
  matchedPolicies: z.array(PolicyVerdictResultSchema),
});
export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;

// ===========================================================================
// Policy Audit
// ===========================================================================

export const PolicyAuditEntrySchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  actionType: z.string(),
  verdict: z.string(),
  reason: z.string(),
  timestamp: z.string(),
  correlationId: z.string(),
  tenantId: z.string(),
  auditHash: z.string(),
});
export type PolicyAuditEntry = z.infer<typeof PolicyAuditEntrySchema>;

export const PolicyRuleFiltersSchema = z.object({
  policyType: z.string().optional(),
  riskClass: z.string().optional(),
  enforcementPoint: z.string().optional(),
  enabled: z.boolean().optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});
export type PolicyRuleFilters = z.infer<typeof PolicyRuleFiltersSchema>;

// ===========================================================================
// Autonomy Configuration
// ===========================================================================

export const AutonomyConfigSchema = z.object({
  currentLevel: AutonomyLevelSchema,
  overrides: z.array(z.object({
    actionType: z.string(),
    level: AutonomyLevelSchema,
  })),
});
export type AutonomyConfig = z.infer<typeof AutonomyConfigSchema>;
