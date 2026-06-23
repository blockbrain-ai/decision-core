/**
 * Org Test Server — Full org-mode HTTP server for integration tests.
 *
 * Creates a Decision Core HTTP server backed by in-memory repositories,
 * fixture-based auth, and the Meridian Systems agent registry.
 */

import { createHttpServer, type HttpServerInstance } from '../../src/surfaces/http/http-server.js';
import type { HttpServerDeps, OrgIdentityResolver } from '../../src/surfaces/http/types.js';
import { InMemoryPolicyRuleRepository } from '../../src/persistence/memory/in-memory-policy-rule.repository.js';
import { InMemoryDecisionLogRepository } from '../../src/persistence/memory/in-memory-decision-log.repository.js';
import { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';
import { NoOpEventService } from '../../src/adapters/event-service.js';
import { resolveAgentRoles, findAgentById } from '../../src/identity/agent-registry.js';
import { hashToken } from '../../src/identity/agent-auth.js';
import { loadMeridianFixtures, type MeridianFixtures } from './org-fixture-loader.js';
import type { AgentRegistryConfig } from '../../src/identity/agent-registry.contracts.js';
import type { AgentAuthStore } from '../../src/identity/agent-auth.contracts.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';

export interface OrgTestServerInstance {
  server: HttpServerInstance;
  fixtures: MeridianFixtures;
  deps: HttpServerDeps;
  policyRuleRepo: InMemoryPolicyRuleRepository;
  decisionLogRepo: InMemoryDecisionLogRepository;
  close(): Promise<void>;
  address(): { host: string; port: number };
  baseUrl(): string;
}

function createOrgIdentityResolver(
  registry: AgentRegistryConfig,
  authStore: AgentAuthStore,
): OrgIdentityResolver {
  return {
    resolve(token: string, bodyAgentId?: string) {
      const binding = authStore.bindings.find(
        (b) => b.subject === hashToken(token, b.salt),
      );

      if (!binding) {
        return { error: 'Bearer token not recognized', code: 'unknown_token' };
      }

      if (!binding.enabled) {
        return { error: `Auth binding for ${binding.agentId} is disabled`, code: 'disabled_binding' };
      }

      if (bodyAgentId && bodyAgentId !== binding.agentId) {
        return {
          error: `Body agentId "${bodyAgentId}" does not match authenticated identity "${binding.agentId}"`,
          code: 'agent_mismatch',
        };
      }

      const agent = findAgentById(registry, binding.agentId);
      if (!agent || !agent.enabled) {
        return { error: `Agent ${binding.agentId} is disabled in registry`, code: 'agent_disabled' };
      }

      const roles = resolveAgentRoles(registry, binding.agentId);

      return {
        agentId: binding.agentId,
        tenantId: binding.tenantId,
        roles,
      };
    },
  };
}

/**
 * Create a full org-mode test server with in-memory repos and fixture auth.
 *
 * Seeds policy rules from the fixture policy pack using the PDP-compatible
 * format so that evaluate calls work end-to-end.
 */
export async function createOrgTestServer(): Promise<OrgTestServerInstance> {
  const fixtures = loadMeridianFixtures();
  const tenantId = fixtures.agents.tenantId as TenantId;

  const policyRuleRepo = new InMemoryPolicyRuleRepository();
  const decisionLogRepo = new InMemoryDecisionLogRepository();
  const eventService = new NoOpEventService();
  const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

  // Seed policy rules from the policy pack fixture.
  // Map pack format rules into PDP-compatible PolicyRuleCreateInput.
  for (const rule of fixtures.policyPack.rules) {
    await policyRuleRepo.create(tenantId, {
      name: rule.name,
      description: rule.description ?? '',
      actionTypePattern: rule.tools?.[0] ?? '*',
      riskClass: 'B',
      enforcementPoint: 'pre_decision',
      policyType: 'business',
      priority: rule.priority,
      requiredConstraints: [],
      requireApproval: rule.action === 'approve_required',
      defaultVerdict: rule.action === 'deny' ? 'deny' : rule.action === 'approve_required' ? 'approve_required' : 'allow',
      requiredRoles: [],
      enabled: true,
    });
  }

  const identityResolver = createOrgIdentityResolver(fixtures.agents, fixtures.tokens);

  const deps: HttpServerDeps = {
    tenantId,
    policyEvaluator: {
      async evaluate(tid: string, _surfaceId: string, action: string, context?: Record<string, unknown>) {
        return pdp.evaluate(tid as TenantId, {
          enforcementPoint: 'pre_decision',
          actionType: action,
          agentId: context?.agentId as string | undefined,
          callerRoles: context?.callerRoles as string[] | undefined,
        });
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

  return {
    server,
    fixtures,
    deps,
    policyRuleRepo,
    decisionLogRepo,
    close: () => server.close(),
    address: () => server.address()!,
    baseUrl() {
      const addr = server.address()!;
      return `http://${addr.host}:${addr.port}`;
    },
  };
}
