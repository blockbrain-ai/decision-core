/**
 * Policy Pack Contract Types
 *
 * Defines the schema for policy pack YAML files that provide
 * out-of-the-box governance configurations for common use cases.
 */

import { z } from 'zod';
import { ActionTypePatternSchema } from './policy.contracts.js';

// ===========================================================================
// Pack Profile
// ===========================================================================

export const PACK_PROFILES = ['personal', 'team', 'enterprise'] as const;
export const PackProfileSchema = z.enum(PACK_PROFILES);
export type PackProfile = z.infer<typeof PackProfileSchema>;

// ===========================================================================
// Pack Rule Action
// ===========================================================================

export const PACK_RULE_ACTIONS = ['allow', 'deny', 'approve_required'] as const;
export const PackRuleActionSchema = z.enum(PACK_RULE_ACTIONS);
export type PackRuleAction = z.infer<typeof PackRuleActionSchema>;

// ===========================================================================
// Policy Rule Definition (Pack format)
// ===========================================================================

export const PolicyRuleDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  action: PackRuleActionSchema,
  surfaces: z.array(z.string()).optional(),
  tools: z.array(ActionTypePatternSchema).optional(),
  conditions: z.object({
    maxAmountUsd: z.number().optional(),
    minAmountUsd: z.number().optional(),
    maxCountPerDay: z.number().int().optional(),
    cooldownMinutes: z.number().int().optional(),
    timeWindowStart: z.string().optional(),
    timeWindowEnd: z.string().optional(),
    requireDualAuthorization: z.boolean().optional(),
    requireAuditTrail: z.boolean().optional(),
    crossTenantAccess: z.boolean().optional(),
  }).optional(),
  priority: z.number().int().default(0),
});
export type PolicyRuleDefinition = z.infer<typeof PolicyRuleDefinitionSchema>;

// ===========================================================================
// Surface Definition (Pack format)
// ===========================================================================

export const SurfaceDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trustTier: z.string().min(1),
  category: z.string().optional(),
});
export type SurfaceDefinition = z.infer<typeof SurfaceDefinitionSchema>;

// ===========================================================================
// Trust Tier Definition (Pack format)
// ===========================================================================

export const TrustTierDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  requiresApproval: z.boolean(),
  requiresAudit: z.boolean().default(false),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});
export type TrustTierDefinition = z.infer<typeof TrustTierDefinitionSchema>;

// ===========================================================================
// Policy Pack (top-level)
// ===========================================================================

export const PolicyPackSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  profile: PackProfileSchema,
  rules: z.array(PolicyRuleDefinitionSchema).min(1),
  surfaces: z.array(SurfaceDefinitionSchema).min(1),
  trustTiers: z.array(TrustTierDefinitionSchema).min(1),
  exampleTools: z.array(ActionTypePatternSchema).default([]),
});
export type PolicyPack = z.infer<typeof PolicyPackSchema>;
