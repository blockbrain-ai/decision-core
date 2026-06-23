/**
 * MCP Surface Types
 *
 * Dependencies and shared types for the MCP server layer.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyRule, PolicyRuleCreateInput, PolicyRuleFilters } from '../../contracts/policy.contracts.js';
import type { DecisionRecord, DecisionFilters } from '../../contracts/decision.contracts.js';
import type { PolicyVerdict } from '../../contracts/policy.contracts.js';

/**
 * Repository interface for policy rules (subset needed by MCP tools).
 */
export interface McpPolicyRuleRepository {
  findAll(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<PolicyRule[]>;
  create(tenantId: TenantId, input: PolicyRuleCreateInput): Promise<PolicyRule>;
}

/**
 * Repository interface for decision logs (subset needed by MCP tools).
 */
export interface McpDecisionLogRepository {
  findAll(tenantId: TenantId, filters?: DecisionFilters): Promise<DecisionRecord[]>;
  findByCorrelationId(tenantId: TenantId, correlationId: string): Promise<DecisionRecord[]>;
}

/**
 * Policy evaluator interface (matches PolicyGuard.evaluate signature).
 */
export interface McpPolicyEvaluator {
  evaluate(
    tenantId: string,
    surfaceId: string,
    action: string,
    context?: Record<string, unknown>,
  ): Promise<PolicyVerdict>;
}

/**
 * Rule compiler interface (subset needed by MCP tools).
 */
export interface McpRuleCompiler {
  compile(tenantId: TenantId, clauseIds: string[]): Promise<unknown>;
}

/**
 * All dependencies the MCP server needs from the SDK/core layer.
 */
export interface McpServerDeps {
  tenantId: string;
  policyEvaluator: McpPolicyEvaluator;
  policyRuleRepo: McpPolicyRuleRepository;
  decisionLogRepo: McpDecisionLogRepository;
  ruleCompiler?: McpRuleCompiler;
}
