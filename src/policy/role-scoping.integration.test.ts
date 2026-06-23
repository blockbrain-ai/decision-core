/**
 * Role-scoping integration test
 *
 * Pins the documented security posture for role-scoped rules:
 *   1. `requiredRoles` is a SCOPING predicate — a role-scoped rule is *skipped*
 *      for a caller who does not hold the role (it does not apply to them).
 *   2. The deny-unknown / default-deny backstop is what actually blocks an
 *      unidentified caller for whom no ALLOW rule applies — so a no-role caller
 *      cannot slip past a role-scoped rule into an implicit allow.
 *
 * This is why public/untrusted surfaces MUST keep deny-unknown enabled
 * (see SECURITY.md and wrapPdpDenyUnknown).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyDecisionPoint } from './policy-decision-point.js';
import { wrapPdpDenyUnknown } from './deny-unknown-wrapper.js';
import { InMemoryPolicyRuleRepository } from '../persistence/memory/in-memory-policy-rule.repository.js';
import { NoOpEventService } from '../adapters/event-service.js';
import type { TenantId } from '../contracts/common.contracts.js';
import type { PolicyContext, PolicyRuleCreateInput } from '../contracts/policy.contracts.js';

const TENANT = 'tenant-role-scope' as TenantId;

function adminOnlyAllowRule(): PolicyRuleCreateInput {
  return {
    name: 'Admins may administer',
    description: 'Role-scoped allow for administrative actions',
    actionTypePattern: 'admin.*',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'safety',
    priority: 10,
    requireApproval: false,
    enabled: true,
    requiredRoles: ['admin'],
    defaultVerdict: 'allow',
  };
}

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return { enforcementPoint: 'pre_decision', actionType: 'admin.delete', ...overrides };
}

describe('role-scoped rules + deny-unknown backstop', () => {
  let repo: InMemoryPolicyRuleRepository;
  let pdp: PolicyDecisionPoint;

  beforeEach(async () => {
    repo = new InMemoryPolicyRuleRepository();
    pdp = new PolicyDecisionPoint(repo, new NoOpEventService());
    await repo.create(TENANT, adminOnlyAllowRule());
  });

  it('skips a role-scoped rule for a caller with no roles (rule does not apply)', async () => {
    const result = await pdp.evaluate(TENANT, ctx({ callerRoles: [] }));
    // The admin-only allow is scoped away → nothing matched. On a bare PDP this
    // reads as a vacuous "allow", which is exactly why the backstop is required.
    expect(result.matchedPolicies).toHaveLength(0);
  });

  it('applies the role-scoped rule for a caller who holds the role', async () => {
    const result = await pdp.evaluate(TENANT, ctx({ callerRoles: ['admin'] }));
    expect(result.verdict).toBe('allow');
    expect(result.matchedPolicies.length).toBeGreaterThan(0);
  });

  it('deny-unknown blocks the no-role caller (no ALLOW rule applied)', async () => {
    const guarded = wrapPdpDenyUnknown(pdp);
    const result = await guarded.evaluate(TENANT, ctx({ callerRoles: [] }));
    expect(result.verdict).toBe('deny');
    expect(result.matchedPolicies[0]?.ruleId).toBe('deny-unknown');
  });

  it('deny-unknown still allows the in-role caller (a real ALLOW applied)', async () => {
    const guarded = wrapPdpDenyUnknown(pdp);
    const result = await guarded.evaluate(TENANT, ctx({ callerRoles: ['admin'] }));
    expect(result.verdict).toBe('allow');
  });
});
