/**
 * Decision Contract Types
 *
 * Defines types for the decision system including
 * decision records, quality gates, and evaluation results.
 */

import { z } from 'zod';

// ===========================================================================
// Decision Status
// ===========================================================================

export const DECISION_STATUSES = ['generated', 'blocked', 'failed', 'pending'] as const;
export const DecisionLogStatusSchema = z.enum(DECISION_STATUSES);
export type DecisionLogStatus = z.infer<typeof DecisionLogStatusSchema>;

// ===========================================================================
// Quality Gate
// ===========================================================================

export const QualityGateScoreSchema = z.object({
  name: z.string(),
  value: z.number(),
  weight: z.number(),
  threshold: z.number(),
});
export type QualityGateScore = z.infer<typeof QualityGateScoreSchema>;

export const QUALITY_GATE_STATUSES = ['pass', 'warn', 'fail'] as const;
export const QualityGateStatusSchema = z.enum(QUALITY_GATE_STATUSES);
export type QualityGateStatus = z.infer<typeof QualityGateStatusSchema>;

export const QualityGateResultSchema = z.object({
  status: QualityGateStatusSchema,
  overallScore: z.number(),
  scores: z.array(QualityGateScoreSchema),
});
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;

// ===========================================================================
// Decision Record
// ===========================================================================

export const DecisionRecordSchema = z.object({
  id: z.string(),
  surface: z.string(),
  toolName: z.string(),
  status: DecisionLogStatusSchema,
  confidence: z.number(),
  model: z.string().optional(),
  latency: z.number(),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()),
  qualityGate: QualityGateResultSchema.optional(),
  correlationId: z.string(),
  tenantId: z.string(),
  auditHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

// ===========================================================================
// Decision Request (evaluate input)
// ===========================================================================

export const DecisionRequestSchema = z.object({
  tenantId: z.string(),
  surface: z.string(),
  toolName: z.string(),
  toolParams: z.record(z.unknown()),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  correlationId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

// ===========================================================================
// Decision Result (evaluate output)
// ===========================================================================

export const DECISION_OUTCOMES = ['allow', 'deny', 'escalate'] as const;
export const DecisionOutcomeSchema = z.enum(DECISION_OUTCOMES);
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

export const RuleMatchSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  verdict: z.string(),
  reason: z.string(),
});
export type RuleMatch = z.infer<typeof RuleMatchSchema>;

export const DecisionResultSchema = z.object({
  decision: DecisionOutcomeSchema,
  reasons: z.array(z.string()),
  autonomyLevel: z.number().int().min(0).max(5),
  matchedRules: z.array(RuleMatchSchema),
  evidenceId: z.string(),
  correlationId: z.string(),
  timestamp: z.string(),
  tenantId: z.string(),
  auditHash: z.string(),
});
export type DecisionResult = z.infer<typeof DecisionResultSchema>;

// ===========================================================================
// Decision Filters
// ===========================================================================

export const DecisionFiltersSchema = z.object({
  surface: z.string().optional(),
  toolName: z.string().optional(),
  status: z.array(DecisionLogStatusSchema).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  minConfidence: z.number().optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});
export type DecisionFilters = z.infer<typeof DecisionFiltersSchema>;
