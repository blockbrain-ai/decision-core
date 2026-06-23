/**
 * Broken Role Resolution — Trusts request-body callerRoles.
 *
 * Mutation: Instead of resolving roles from the token-bound agent identity,
 * this resolver trusts whatever callerRoles the client sends in the request
 * body context. When swapped in, RBAC spoofing tests must fail because
 * clients can escalate their own privileges.
 */

import type { OrgIdentityResolver } from '../../src/surfaces/http/types.js';
import type { AgentRegistryConfig } from '../../src/identity/agent-registry.contracts.js';
import type { AgentAuthStore } from '../../src/identity/agent-auth.contracts.js';
import { hashToken } from '../../src/identity/agent-auth.js';
import { findAgentById } from '../../src/identity/agent-registry.js';

/**
 * Creates an identity resolver that authenticates the token correctly but
 * returns whatever roles the client claims in the body instead of the
 * server-resolved roles. This breaks the RBAC invariant.
 *
 * The HTTP server passes client-supplied callerRoles via the evaluate context.
 * This broken resolver stores them so the mutation test can inject them.
 */
export function createBrokenRoleResolver(
  registry: AgentRegistryConfig,
  authStore: AgentAuthStore,
): OrgIdentityResolver & { injectRoles: (roles: string[]) => void } {
  let injectedRoles: string[] | null = null;

  return {
    injectRoles(roles: string[]) {
      injectedRoles = roles;
    },

    resolve(token: string, bodyAgentId?: string) {
      if (!token) {
        return { error: 'No bearer token provided', code: 'no_token' };
      }

      // Token lookup is correct
      const binding = authStore.bindings.find(
        (b) => b.subject === hashToken(token, b.salt),
      );
      if (!binding) {
        return { error: 'Bearer token not recognized', code: 'unknown_token' };
      }

      if (!binding.enabled) {
        return { error: `Auth binding for ${binding.agentId} is disabled`, code: 'disabled_binding' };
      }

      // Body agentId check is correct
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

      // BROKEN: Use injected roles if available instead of server-resolved roles.
      // This simulates trusting client-supplied callerRoles from the request body.
      const roles = injectedRoles ?? agent.roles;

      return {
        agentId: binding.agentId,
        tenantId: binding.tenantId,
        roles,
      };
    },
  };
}
