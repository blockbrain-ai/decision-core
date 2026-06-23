/**
 * HTTP Surface Types
 *
 * Dependencies and shared types for the HTTP API server.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyRule, PolicyRuleFilters } from '../../contracts/policy.contracts.js';
import type { DecisionRecord, DecisionFilters } from '../../contracts/decision.contracts.js';
import type { PolicyVerdict } from '../../contracts/policy.contracts.js';
import type { DecisionEvidenceSink } from '../../integrity/evidence-sinks/decision-evidence-sink.js';

/**
 * Repository interface for policy rules (subset needed by HTTP routes).
 */
export interface HttpPolicyRuleRepository {
  findAll(tenantId: TenantId, filters?: PolicyRuleFilters): Promise<PolicyRule[]>;
}

/**
 * Repository interface for decision logs (subset needed by HTTP routes).
 */
export interface HttpDecisionLogRepository {
  findAll(tenantId: TenantId, filters?: DecisionFilters): Promise<DecisionRecord[]>;
  findByCorrelationId(tenantId: TenantId, correlationId: string): Promise<DecisionRecord[]>;
}

/**
 * Policy evaluator interface (matches PolicyGuard.evaluate signature).
 */
export interface HttpPolicyEvaluator {
  evaluate(
    tenantId: string,
    surfaceId: string,
    action: string,
    context?: Record<string, unknown>,
  ): Promise<PolicyVerdict>;
}

/**
 * All dependencies the HTTP server needs from the SDK/core layer.
 */
export interface HttpServerDeps {
  tenantId: string;
  policyEvaluator: HttpPolicyEvaluator;
  policyRuleRepo: HttpPolicyRuleRepository;
  decisionLogRepo: HttpDecisionLogRepository;
  evidenceSink?: DecisionEvidenceSink;
}

/**
 * Org-mode identity resolver: maps bearer token to agent identity.
 */
export interface OrgIdentityResolver {
  resolve(token: string, bodyAgentId?: string): { agentId: string; tenantId: string; roles: string[] } | { error: string; code: string };
}

export interface HttpOrgConfig {
  agentRegistryPath: string;
  accessPolicyPath: string;
}

/**
 * HTTP server configuration.
 */
export interface HttpServerConfig {
  host?: string;
  port?: number;
  bearerToken?: string;
  orgMode?: boolean;
  identityResolver?: OrgIdentityResolver;
  orgConfig?: HttpOrgConfig;
}
