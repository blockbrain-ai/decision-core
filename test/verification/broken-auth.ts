/**
 * Broken Auth — Accepts any bearer token regardless of validity.
 *
 * Mutation: Disables token validation so any Authorization header is accepted.
 * When swapped into the org test server, identity spoofing tests must fail
 * because any token (including forged ones) will be treated as valid.
 */

import type { OrgIdentityResolver } from '../../src/surfaces/http/types.js';
import type { AgentRegistryConfig } from '../../src/identity/agent-registry.contracts.js';
import type { AgentAuthStore } from '../../src/identity/agent-auth.contracts.js';
import { resolveAgentRoles, findAgentById } from '../../src/identity/agent-registry.js';

/**
 * Creates an identity resolver that accepts ANY bearer token as the first
 * enabled agent in the auth store. This breaks the security invariant that
 * only the correct token maps to a specific agent identity.
 */
export function createBrokenAuthResolver(
  registry: AgentRegistryConfig,
  authStore: AgentAuthStore,
): OrgIdentityResolver {
  return {
    resolve(token: string, bodyAgentId?: string) {
      // BROKEN: Skip token hashing and lookup — accept any non-empty token.
      // Map to the first enabled binding regardless of token value.
      if (!token) {
        return { error: 'Bearer token required', code: 'no_token' };
      }

      // Accept any token: just pick the first enabled binding
      const binding = authStore.bindings.find((b) => b.enabled);
      if (!binding) {
        return { error: 'No enabled bindings', code: 'unknown_token' };
      }

      // BROKEN: If a bodyAgentId is supplied, trust it and resolve that
      // agent instead — this allows identity spoofing via the body.
      const targetAgentId = bodyAgentId ?? binding.agentId;

      const agent = findAgentById(registry, targetAgentId);
      if (!agent || !agent.enabled) {
        return { error: `Agent ${targetAgentId} is disabled`, code: 'agent_disabled' };
      }

      const roles = resolveAgentRoles(registry, targetAgentId);
      return {
        agentId: targetAgentId,
        tenantId: binding.tenantId,
        roles,
      };
    },
  };
}
