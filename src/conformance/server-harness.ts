/**
 * Conformance Server Harness
 *
 * Starts a self-contained org-mode HTTP server backed by in-memory
 * repositories and Meridian Systems fixtures. Used by the conformance
 * CLI to run scenarios without external dependencies.
 */

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createHttpServer } from '../surfaces/http/http-server.js';
import type { HttpServerDeps, OrgIdentityResolver } from '../surfaces/http/types.js';
import { InMemoryPolicyRuleRepository } from '../persistence/memory/in-memory-policy-rule.repository.js';
import { InMemoryDecisionLogRepository } from '../persistence/memory/in-memory-decision-log.repository.js';
import { PolicyDecisionPoint } from '../policy/policy-decision-point.js';
import { NoOpEventService } from '../adapters/event-service.js';
import { resolveAgentRoles, findAgentById } from '../identity/agent-registry.js';
import { hashToken } from '../identity/agent-auth.js';
import { AgentRegistryConfigSchema, type AgentRegistryConfig } from '../identity/agent-registry.contracts.js';
import { AgentAuthStoreSchema, type AgentAuthStore } from '../identity/agent-auth.contracts.js';
import type { TenantId } from '../contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../contracts/policy.contracts.js';

const MERIDIAN_TEST_TOKENS: Record<string, string> = {
  'ceo-agent': 'mrd-test-token-ceo-agent',
  'cfo-agent': 'mrd-test-token-cfo-agent',
  'finance-analyst-agent': 'mrd-test-token-finance-analyst-agent',
  'vp-eng-agent': 'mrd-test-token-vp-eng-agent',
  'hr-lead-agent': 'mrd-test-token-hr-lead-agent',
  'product-agent': 'mrd-test-token-product-agent',
  'contractor-agent': 'mrd-test-token-contractor-agent',
};

/** RBAC policy rules — mirrors test/helpers/rbac-test-server.ts */
const RBAC_RULES: PolicyRuleCreateInput[] = [
  { name: 'finance-report-read-allow', description: 'Allow finance roles to read financial reports', actionTypePattern: 'finance-report-read', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['finance', 'finance_analyst'], roleMatchMode: 'any', enabled: true },
  { name: 'finance-summary-read-allow', description: 'Allow finance roles to read financial summaries', actionTypePattern: 'finance-summary-read', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['finance', 'finance_analyst'], roleMatchMode: 'any', enabled: true },
  { name: 'finance-transfer-allow', description: 'Allow finance role to initiate transfers', actionTypePattern: 'finance-transfer', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['finance'], enabled: true },
  { name: 'finance-budget-update-allow', description: 'Allow finance role to update budgets', actionTypePattern: 'finance-budget-update', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['finance'], enabled: true },
  { name: 'hr-record-read-allow', description: 'Allow HR roles to read personnel records', actionTypePattern: 'hr-record-read', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['hr', 'people_ops'], roleMatchMode: 'any', enabled: true },
  { name: 'hr-record-update-allow', description: 'Allow people_ops to update personnel records', actionTypePattern: 'hr-record-update', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['people_ops'], enabled: true },
  { name: 'deploy-staging-allow', description: 'Allow deployer role to deploy to staging', actionTypePattern: 'deploy-staging', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['deployer'], enabled: true },
  { name: 'deploy-production-approval', description: 'Production deployment requires approval', actionTypePattern: 'deploy-production', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: true, requiredRoles: ['deployer'], enabled: true },
  { name: 'executive-approve-allow', description: 'Executive+approver can approve requests', actionTypePattern: 'approve-request', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['executive', 'approver'], roleMatchMode: 'all', enabled: true },
  { name: 'executive-reject-allow', description: 'Executive+approver can reject requests', actionTypePattern: 'reject-request', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['executive', 'approver'], roleMatchMode: 'all', enabled: true },
  { name: 'audit-review-allow', description: 'Executive+audit_admin can review audits', actionTypePattern: 'audit-review', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['executive', 'audit_admin'], roleMatchMode: 'all', enabled: true },
  { name: 'contractor-deny-finance', description: 'Contractors cannot access finance operations', actionTypePattern: 'finance-*', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 200, requiredConstraints: [], requireApproval: false, defaultVerdict: 'deny', requiredRoles: ['contractor'], enabled: true },
  { name: 'contractor-deny-hr', description: 'Contractors cannot access HR operations', actionTypePattern: 'hr-*', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 200, requiredConstraints: [], requireApproval: false, defaultVerdict: 'deny', requiredRoles: ['contractor'], enabled: true },
  { name: 'contractor-deny-deploy', description: 'Contractors cannot trigger deployments', actionTypePattern: 'deploy-*', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 200, requiredConstraints: [], requireApproval: false, defaultVerdict: 'deny', requiredRoles: ['contractor'], enabled: true },
  { name: 'contractor-deny-approval', description: 'Contractors cannot access approval queue', actionTypePattern: '*-request', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 200, requiredConstraints: [], requireApproval: false, defaultVerdict: 'deny', requiredRoles: ['contractor'], enabled: true },
  { name: 'contractor-deny-audit', description: 'Contractors cannot review audits', actionTypePattern: 'audit-*', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 200, requiredConstraints: [], requireApproval: false, defaultVerdict: 'deny', requiredRoles: ['contractor'], enabled: true },
  { name: 'public-read-allow', description: 'All authenticated agents can read public data', actionTypePattern: 'public-*', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 50, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', enabled: true },
  { name: 'brain-lookup-allow', description: 'All authenticated agents can look up brain data', actionTypePattern: 'brain-lookup', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 80, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', enabled: true },
  // ---- Approval: vendor-payment-high requires approval for finance role ----
  { name: 'vendor-payment-high-approval', description: 'High-value vendor payments require approval', actionTypePattern: 'vendor-payment-high', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: true, requiredRoles: ['finance'], enabled: true },
  // ---- Tool drift: newly-classified tool allowed for finance ----
  { name: 'newly-classified-read-allow', description: 'Newly classified read tool allowed for finance roles', actionTypePattern: 'newly-classified-read-tool', riskClass: 'B', enforcementPoint: 'pre_decision', policyType: 'business', priority: 100, requiredConstraints: [], requireApproval: false, defaultVerdict: 'allow', requiredRoles: ['finance', 'finance_analyst'], roleMatchMode: 'any', enabled: true },
];

export interface ConformanceServerInstance {
  baseUrl: string;
  close(): Promise<void>;
}

function loadYaml<T>(fixturesDir: string, filename: string): T {
  const raw = readFileSync(join(fixturesDir, filename), 'utf-8');
  return parseYaml(raw) as T;
}

function createIdentityResolver(
  registry: AgentRegistryConfig,
  authStore: AgentAuthStore,
): OrgIdentityResolver {
  return {
    resolve(token: string, bodyAgentId?: string) {
      const binding = authStore.bindings.find(
        (b) => b.subject === hashToken(token, b.salt),
      );
      if (!binding) return { error: 'Bearer token not recognized', code: 'unknown_token' };
      if (!binding.enabled) return { error: `Auth binding for ${binding.agentId} is disabled`, code: 'disabled_binding' };
      if (bodyAgentId && bodyAgentId !== binding.agentId) {
        return { error: `Body agentId mismatch`, code: 'agent_mismatch' };
      }
      const agent = findAgentById(registry, binding.agentId);
      if (!agent || !agent.enabled) return { error: `Agent ${binding.agentId} is disabled`, code: 'agent_disabled' };
      const roles = resolveAgentRoles(registry, binding.agentId);
      return { agentId: binding.agentId, tenantId: binding.tenantId, roles };
    },
  };
}

/**
 * Start a conformance test server. Returns base URL and close function.
 */
export async function startConformanceServer(projectRoot: string): Promise<ConformanceServerInstance> {
  const fixturesDir = resolve(projectRoot, 'test', 'fixtures', 'meridian-systems');
  const agents = AgentRegistryConfigSchema.parse(loadYaml(fixturesDir, 'agents.yaml'));
  const tokens = AgentAuthStoreSchema.parse(loadYaml(fixturesDir, 'tokens.yaml'));
  const tenantId = agents.tenantId as TenantId;

  const policyRuleRepo = new InMemoryPolicyRuleRepository();
  const decisionLogRepo = new InMemoryDecisionLogRepository();
  const eventService = new NoOpEventService();
  const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

  for (const rule of RBAC_RULES) {
    await policyRuleRepo.create(tenantId, rule);
  }

  const identityResolver = createIdentityResolver(agents, tokens);

  const deps: HttpServerDeps = {
    tenantId,
    policyEvaluator: {
      async evaluate(tid: string, _surfaceId: string, action: string, context?: Record<string, unknown>) {
        const result = await pdp.evaluate(tid as TenantId, {
          enforcementPoint: 'pre_decision',
          actionType: action,
          agentId: context?.agentId as string | undefined,
          callerRoles: context?.callerRoles as string[] | undefined,
        });
        if (result.verdict === 'allow' && result.matchedPolicies.length === 0) {
          return {
            verdict: 'deny' as const,
            matchedPolicies: [{
              ruleId: 'deny-unknown',
              ruleName: 'deny-unknown-default',
              verdict: 'deny' as const,
              reason: 'No policy rules matched — denied by default',
            }],
          };
        }
        return result;
      },
    },
    policyRuleRepo,
    decisionLogRepo,
  };

  const server = await createHttpServer(deps, {
    host: '127.0.0.1',
    port: 0,
    orgMode: true,
    identityResolver,
  });

  const addr = server.address();
  if (!addr) {
    throw new Error('Conformance HTTP server did not expose a bound address');
  }

  return {
    baseUrl: `http://${addr.host}:${addr.port}`,
    close: () => server.close(),
  };
}

/**
 * Get the deterministic test token for a given agent ID.
 */
export function getAgentToken(agentId: string): string {
  const token = MERIDIAN_TEST_TOKENS[agentId];
  if (!token) throw new Error(`No test token defined for agent: ${agentId}`);
  return token;
}
