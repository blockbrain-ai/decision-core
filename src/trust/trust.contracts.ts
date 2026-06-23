/**
 * Trust Framework Contracts
 *
 * Zod schemas and types for trust policies, surface bindings,
 * decision patterns, and pattern results.
 */

import { z } from 'zod';

// ===========================================================================
// Risk Tiers
// ===========================================================================

export const RISK_TIERS = ['critical', 'intermediate', 'low'] as const;
export const RiskTierSchema = z.enum(RISK_TIERS);
export type RiskTier = z.infer<typeof RiskTierSchema>;

// ===========================================================================
// Review Modes
// ===========================================================================

export const REVIEW_MODES = ['always', 'borderline', 'tribunal', 'autonomous', 'none'] as const;
export const ReviewModeSchema = z.enum(REVIEW_MODES);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

// ===========================================================================
// Pattern Types
// ===========================================================================

export const PATTERN_TYPES = ['single_model', 'primary_reviewer', 'tribunal', 'a5_hybrid'] as const;
export const PatternTypeSchema = z.enum(PATTERN_TYPES);
export type PatternType = z.infer<typeof PatternTypeSchema>;

// ===========================================================================
// Fallback Strategies
// ===========================================================================

export const FALLBACK_STRATEGIES = ['safe_block', 'downgrade_pattern', 'accept_primary'] as const;
export const FallbackStrategySchema = z.enum(FALLBACK_STRATEGIES);
export type FallbackStrategy = z.infer<typeof FallbackStrategySchema>;

// ===========================================================================
// Autonomy Status
// ===========================================================================

export const AUTONOMY_STATUSES = ['verified_autonomous', 'safe_block', 'failed'] as const;
export const AutonomyStatusSchema = z.enum(AUTONOMY_STATUSES);
export type AutonomyStatus = z.infer<typeof AutonomyStatusSchema>;

// ===========================================================================
// Verification Status
// ===========================================================================

export const VERIFICATION_STATUSES = [
  'verified',
  'review_required',
  'rejected',
  'fallback',
  'not_applicable',
] as const;
export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

// ===========================================================================
// Surface Binding Role
// ===========================================================================

export const SurfaceBindingRoleSchema = z.object({
  modelPolicy: z.string(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().optional(),
});
export type SurfaceBindingRole = z.infer<typeof SurfaceBindingRoleSchema>;

// ===========================================================================
// Tribunal Config (within binding)
// ===========================================================================

export const TribunalBindingConfigSchema = z.object({
  panelId: z.string().optional(),
  arbiterOnDisagreementOnly: z.boolean().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});
export type TribunalBindingConfig = z.infer<typeof TribunalBindingConfigSchema>;

// ===========================================================================
// Surface Binding
// ===========================================================================

export const SurfaceBindingSchema = z.object({
  surfaceId: z.string(),
  pattern: PatternTypeSchema,
  roles: z.record(z.string(), SurfaceBindingRoleSchema),
  fallbackPattern: PatternTypeSchema.optional(),
  fallbackStrategy: FallbackStrategySchema,
  tribunalConfig: TribunalBindingConfigSchema.optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});
export type SurfaceBinding = z.infer<typeof SurfaceBindingSchema>;

// ===========================================================================
// Trust Policy Entry (per-surface)
// ===========================================================================

export const TrustPolicyEntrySchema = z.object({
  surfaceId: z.string(),
  riskTier: RiskTierSchema,
  modelPolicy: z.string(),
  reviewMode: ReviewModeSchema,
  hardFailOnMiss: z.boolean().optional(),
  primaryModelPolicy: z.string().optional(),
  reviewerModelPolicy: z.string().optional(),
});
export type TrustPolicyEntry = z.infer<typeof TrustPolicyEntrySchema>;

// ===========================================================================
// Trust Policy (full config)
// ===========================================================================

export const TrustPolicySchema = z.object({
  version: z.string(),
  policies: z.array(TrustPolicyEntrySchema),
});
export type TrustPolicy = z.infer<typeof TrustPolicySchema>;

// ===========================================================================
// Surface Registry Entry
// ===========================================================================

export const SurfaceRegistryEntrySchema = z.object({
  surfaceId: z.string(),
  category: z.string(),
  description: z.string(),
  riskTier: RiskTierSchema,
  requiredCapabilities: z.array(z.string()).optional(),
});
export type SurfaceRegistryEntry = z.infer<typeof SurfaceRegistryEntrySchema>;

// ===========================================================================
// Surface Registry
// ===========================================================================

export const SurfaceRegistrySchema = z.object({
  version: z.string(),
  surfaces: z.array(SurfaceRegistryEntrySchema),
});
export type SurfaceRegistry = z.infer<typeof SurfaceRegistrySchema>;

// ===========================================================================
// Surface Bindings Config
// ===========================================================================

export const SurfaceBindingsConfigSchema = z.object({
  version: z.string(),
  bindings: z.array(SurfaceBindingSchema),
});
export type SurfaceBindingsConfig = z.infer<typeof SurfaceBindingsConfigSchema>;

// ===========================================================================
// Pattern Execution Context
// ===========================================================================

export const PatternContextSchema = z.object({
  surfaceId: z.string(),
  prompt: z.string(),
  tenantId: z.string(),
  correlationId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type PatternContext = z.infer<typeof PatternContextSchema>;

// ===========================================================================
// Pattern Result
// ===========================================================================

export const PatternResultSchema = z.object({
  output: z.unknown().nullable(),
  modelUsed: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  latency: z.number().nonnegative().nullable(),
  patternUsed: PatternTypeSchema,
  verificationStatus: VerificationStatusSchema,
  finalDecisionSource: z.enum(['primary', 'reviewer', 'fallback', 'tribunal_arbiter']),
  autonomyStatus: AutonomyStatusSchema,
  reason: z.string().nullable(),
});
export type PatternResult = z.infer<typeof PatternResultSchema>;

// ===========================================================================
// Tribunal Panel Member
// ===========================================================================

export const PanelMemberSchema = z.object({
  role: z.enum(['assessor', 'arbiter']),
  modelPolicy: z.string(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export type PanelMember = z.infer<typeof PanelMemberSchema>;

// ===========================================================================
// Tribunal Panel
// ===========================================================================

export const TribunalPanelSchema = z.object({
  panelId: z.string(),
  assessors: z.array(PanelMemberSchema).min(2),
  arbiter: PanelMemberSchema,
  arbiterOnDisagreementOnly: z.boolean().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});
export type TribunalPanel = z.infer<typeof TribunalPanelSchema>;

// ===========================================================================
// Tribunal Config (top-level)
// ===========================================================================

export const TribunalConfigSchema = z.object({
  version: z.string(),
  defaults: z.object({
    assessorCount: z.number().int().min(2),
    confidenceThreshold: z.number().min(0).max(1),
  }),
  panels: z.record(z.string(), TribunalPanelSchema),
});
export type TribunalConfig = z.infer<typeof TribunalConfigSchema>;
