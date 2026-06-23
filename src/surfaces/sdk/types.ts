/**
 * TypeScript SDK Public Types
 *
 * Defines the public-facing types for createDecisionCore and createPolicyGuard.
 */

import { z } from 'zod';
import type { DecisionRunnerResult, DecisionContext } from '../../decisions/decision-runner.js';
import type { BaseDecision } from '../../decisions/base-decision.js';
import type { PolicyVerdict } from '../../contracts/policy.contracts.js';
import type { HostModelCallback, HttpAdapterFn } from '../../core/model-gateway.js';
import { SurfaceContractSchema } from '../../knowledge/surfaces/surface-contract.types.js';
import type { SurfaceContractRegistry } from '../../knowledge/surfaces/surface-contract-registry.service.js';

// ===========================================================================
// Configuration Schemas
// ===========================================================================

// Supported persistence tiers for v0.1: in-memory (default, zero-dep) and SQLite.
// A Postgres tier is roadmapped (v0.2) and is intentionally NOT advertised here so
// the public type never promises an option that throws at runtime.
export const PersistenceTierSchema = z.enum(['memory', 'sqlite']);
export type PersistenceTier = z.infer<typeof PersistenceTierSchema>;

export const ProviderModeSchema = z.enum(['host', 'disabled', 'direct', 'local', 'router']);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

export const TenantModeSchema = z.enum(['single', 'multi']);
export type TenantMode = z.infer<typeof TenantModeSchema>;

export const TrustConfigSchema = z.object({
  policyPath: z.string().optional(),
  bindingsPath: z.string().optional(),
  registryPath: z.string().optional(),
}).optional();
export type TrustConfig = z.infer<typeof TrustConfigSchema>;

export const ProviderConfigSchema = z.object({
  mode: ProviderModeSchema.default('disabled'),
  hostCallback: z.custom<HostModelCallback>().optional(),
  httpAdapter: z.custom<HttpAdapterFn>().optional(),
  profilesPath: z.string().optional(),
  currentLab: z.string().optional(),
}).optional();
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const DecisionCoreConfigSchema = z.object({
  persistence: PersistenceTierSchema.default('memory'),
  provider: ProviderConfigSchema,
  policyPackPath: z.string().optional(),
  sqlitePath: z.string().optional(),
  denyUnknownDefault: z.boolean().optional(),
  trustConfig: TrustConfigSchema,
  tenantMode: TenantModeSchema.default('single'),
  tenantId: z.string().default('default'),
  routeConfigPath: z.string().optional(),
  agentRegistryPath: z.string().optional(),
  agentAuthPath: z.string().optional(),
  accessPolicyPath: z.string().optional(),
  surfaceContracts: z.array(SurfaceContractSchema).optional(),
  surfaceContractPath: z.string().optional(),
  useDefaultSurfaceContracts: z.boolean().optional(),
});
export type DecisionCoreConfig = z.infer<typeof DecisionCoreConfigSchema>;

export const PolicyGuardConfigSchema = z.object({
  policyPackPath: z.string().optional(),
  tenantId: z.string().default('default'),
  denyUnknownDefault: z.boolean().optional(),
  agentRegistryPath: z.string().optional(),
});
export type PolicyGuardConfig = z.infer<typeof PolicyGuardConfigSchema>;

// ===========================================================================
// Public Instance Types
// ===========================================================================

export interface DecisionCore {
  /**
   * Execute a decision through the full pipeline.
   */
  evaluate<TInput, TOutput>(
    decision: BaseDecision<TInput, TOutput>,
    context?: DecisionContext,
  ): Promise<DecisionRunnerResult<TOutput>>;

  /**
   * Explain a previous decision by correlation ID.
   */
  explain(correlationId: string): Promise<Explanation>;

  /**
   * The tenant ID this instance operates under (single-tenant mode).
   */
  readonly tenantId: string;

  /**
   * Surface contract registry (populated only when surfaceContracts, surfaceContractPath, or useDefaultSurfaceContracts is configured).
   */
  readonly surfaceContractRegistry: SurfaceContractRegistry;
}

export interface DecisionCoreWithExplain extends Omit<DecisionCore, 'explain'> {
  /**
   * Enhanced explain returning a human-readable DecisionExplanation.
   */
  explain(decisionId: string): Promise<DecisionExplanation>;
}

export interface PolicyGuard {
  /**
   * Evaluate policy rules against an action.
   */
  evaluate(
    tenantId: string,
    surfaceId: string,
    action: string,
    context?: Record<string, unknown>,
  ): Promise<PolicyVerdict>;
}

export interface Explanation {
  correlationId: string;
  tenantId: string;
  records: ExplanationRecord[];
}

export interface ExplanationRecord {
  id: string;
  surface: string;
  status: string;
  confidence: number;
  latency: number;
  auditHash: string;
  createdAt: string;
}

// ===========================================================================
// QuickStart Options
// ===========================================================================

export const QuickStartProfileSchema = z.enum(['personal', 'team', 'enterprise']);
export type QuickStartProfile = z.infer<typeof QuickStartProfileSchema>;

export const QuickStartOptionsSchema = z.object({
  agent: z.string().optional(),
  tools: z.array(z.string()).optional(),
  profile: QuickStartProfileSchema.optional(),
  providerMode: z.enum(['host', 'disabled', 'direct', 'local']).optional(),
  storage: z.enum(['memory', 'sqlite']).optional(),
  sqlitePath: z.string().optional(),
}).optional();
export type QuickStartOptions = z.infer<typeof QuickStartOptionsSchema>;

// ===========================================================================
// Decision Explanation (enhanced)
// ===========================================================================

export interface DecisionExplanation {
  decisionId: string;
  timestamp: string;
  surface: string;
  toolName: string;
  verdict: 'allow' | 'deny' | 'approve_required';
  summary: string;
  rulesEvaluated: {
    ruleId: string;
    ruleName: string;
    result: 'allow' | 'deny' | 'approve_required' | 'not_applicable';
    reason: string;
  }[];
  trustTier: string;
  evidenceSummary: string;
}

// ===========================================================================
// Policy Pack Schema (YAML structure)
// ===========================================================================

export const PolicyPackRuleSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  actionTypePattern: z.string(),
  riskClass: z.enum(['A', 'B', 'C']).default('B'),
  enforcementPoint: z.enum(['pre_decision', 'action_dispatch', 'post_execution']).default('pre_decision'),
  policyType: z.enum(['safety', 'compliance', 'business', 'resource', 'quality']).default('business'),
  priority: z.number().int().default(50),
  maxAmountUsd: z.number().optional(),
  maxCountPerDay: z.number().int().optional(),
  cooldownMinutes: z.number().int().optional(),
  timeWindowStart: z.string().optional(),
  timeWindowEnd: z.string().optional(),
  minDataQuality: z.number().optional(),
  minConfidence: z.number().optional(),
  requiredConstraints: z.array(z.string()).default([]),
  requireApproval: z.boolean().default(false),
  defaultVerdict: z.enum(['allow', 'deny', 'approve_required']).optional(),
  requiredRoles: z.array(z.string()).optional(),
  roleMatchMode: z.enum(['any', 'all']).optional(),
  approverRole: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type PolicyPackRule = z.infer<typeof PolicyPackRuleSchema>;

export const PolicyPackSchema = z.object({
  version: z.string().default('1.0.0'),
  name: z.string().optional(),
  description: z.string().optional(),
  denyUnknownDefault: z.boolean().default(false),
  rules: z.array(PolicyPackRuleSchema),
});
export type PolicyPack = z.infer<typeof PolicyPackSchema>;
