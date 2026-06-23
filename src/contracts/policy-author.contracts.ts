/**
 * Policy Author Contracts
 *
 * Types for the natural language → policy rule authoring skill.
 * Candidate rules are always drafts; never auto-activated.
 */

import { z } from 'zod';

// ===========================================================================
// Confidence Level
// ===========================================================================

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export const ConfidenceLevelSchema = z.enum(CONFIDENCE_LEVELS);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

// ===========================================================================
// Candidate Rule Status
// ===========================================================================

export const CANDIDATE_RULE_STATUSES = ['draft', 'accepted', 'rejected', 'needs_human_policy_authoring'] as const;
export const CandidateRuleStatusSchema = z.enum(CANDIDATE_RULE_STATUSES);
export type CandidateRuleStatus = z.infer<typeof CandidateRuleStatusSchema>;

// ===========================================================================
// Review Action
// ===========================================================================

export const REVIEW_ACTIONS = ['accept', 'modify', 'reject'] as const;
export const ReviewActionSchema = z.enum(REVIEW_ACTIONS);
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

// ===========================================================================
// Candidate Rule
// ===========================================================================

export const CandidateRuleSchema = z.object({
  id: z.string(),
  yamlContent: z.string(),
  explanation: z.string(),
  confidence: ConfidenceLevelSchema,
  status: CandidateRuleStatusSchema,
  sourceText: z.string(),
  ruleType: z.string(),
  affectedSurfaces: z.array(z.string()),
  affectedTools: z.array(z.string()),
});
export type CandidateRule = z.infer<typeof CandidateRuleSchema>;

// ===========================================================================
// Policy Author Request
// ===========================================================================

export const PolicyAuthorContextSchema = z.object({
  existingSurfaces: z.array(z.string()).optional(),
  existingTools: z.array(z.string()).optional(),
  existingRules: z.array(z.string()).optional(),
});
export type PolicyAuthorContext = z.infer<typeof PolicyAuthorContextSchema>;

export const PolicyAuthorRequestSchema = z.object({
  naturalLanguage: z.string().min(1),
  context: PolicyAuthorContextSchema.optional(),
});
export type PolicyAuthorRequest = z.infer<typeof PolicyAuthorRequestSchema>;

// ===========================================================================
// Policy Author Result
// ===========================================================================

export const PolicyAuthorResultSchema = z.object({
  sessionId: z.string(),
  candidateRules: z.array(CandidateRuleSchema),
  warnings: z.array(z.string()),
  ambiguities: z.array(z.string()),
});
export type PolicyAuthorResult = z.infer<typeof PolicyAuthorResultSchema>;

// ===========================================================================
// Document Ingestion Request
// ===========================================================================

export const DocumentIngestionRequestSchema = z.object({
  documentContent: z.string().min(1),
  documentName: z.string().optional(),
  context: PolicyAuthorContextSchema.optional(),
});
export type DocumentIngestionRequest = z.infer<typeof DocumentIngestionRequestSchema>;

// ===========================================================================
// Review Request
// ===========================================================================

export const ReviewRequestSchema = z.object({
  ruleId: z.string(),
  action: ReviewActionSchema,
  modifiedYaml: z.string().optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

// ===========================================================================
// Commit Result
// ===========================================================================

export const CommitResultSchema = z.object({
  committedRuleIds: z.array(z.string()),
  policiesYaml: z.string(),
  warnings: z.array(z.string()),
});
export type CommitResult = z.infer<typeof CommitResultSchema>;

// ===========================================================================
// Conflict Detection
// ===========================================================================

export const RuleConflictSchema = z.object({
  candidateRuleId: z.string(),
  conflictingRuleId: z.string(),
  conflictingRuleName: z.string(),
  reason: z.string(),
});
export type RuleConflict = z.infer<typeof RuleConflictSchema>;
