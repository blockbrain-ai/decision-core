/**
 * Broken Access Policy — Grants all roles access to all classifications.
 *
 * Mutation: Ignores neverAccessibleBy and returns all brains for any role.
 * When swapped in, isolation tests must fail because every role can access
 * every classification regardless of the access policy configuration.
 */

import type { AccessPolicyConfig } from '../../src/identity/access-policy.contracts.js';
import type { AccessViolation } from '../../src/identity/access-policy-loader.js';

/**
 * Returns ALL brains regardless of role — ignores neverAccessibleBy.
 */
export function brokenGetAuthorisedBrains(policy: AccessPolicyConfig, _role: string): string[] {
  return policy.classifications.map((c) => c.brain);
}

/**
 * Always returns true — any role can access any classification.
 */
export function brokenCanAccess(
  _policy: AccessPolicyConfig,
  _role: string,
  _classificationName: string,
): boolean {
  return true;
}

/**
 * Never detects violations — all mounts are considered valid.
 */
export function brokenVerifyMounts(
  _policy: AccessPolicyConfig,
  _agentMounts: Array<{ agentId: string; roles: string[]; mountedBrains: string[] }>,
): AccessViolation[] {
  return [];
}
