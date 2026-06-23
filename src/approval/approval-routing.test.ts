import { describe, it, expect } from 'vitest';
import { resolveApprover, checkSeparationOfDuties } from './approval-routing.js';
import type { PolicyRule } from '../contracts/policy.contracts.js';
import type { AgentRegistryConfig } from '../identity/agent-registry.contracts.js';

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    description: '',
    actionTypePattern: '**',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 10,
    requiredConstraints: [],
    requireApproval: true,
    enabled: true,
    tenantId: 'default',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const registry: AgentRegistryConfig = {
  tenantId: 'default',
  agents: [
    { agentId: 'ceo-agent', displayName: 'CEO', roles: ['ceo'], surfaces: [], enabled: true },
    { agentId: 'finance-agent', displayName: 'Finance', roles: ['finance_approver'], surfaces: [], enabled: true },
    { agentId: 'compliance-agent', displayName: 'Compliance', roles: ['compliance_officer'], surfaces: [], enabled: true },
    { agentId: 'product-agent', displayName: 'Product', roles: ['product_manager'], surfaces: [], enabled: true },
  ],
};

describe('resolveApprover', () => {
  it('uses explicit approverRole from rule', () => {
    const rule = makeRule({ approverRole: 'product_manager' });
    const result = resolveApprover(rule, registry);
    expect(result?.role).toBe('product_manager');
    expect(result?.agentIds).toContain('product-agent');
  });

  it('defaults compliance rules to compliance_officer', () => {
    const rule = makeRule({ policyType: 'compliance', approverRole: undefined });
    const result = resolveApprover(rule, registry);
    expect(result?.role).toBe('compliance_officer');
  });

  it('defaults safety rules to ceo', () => {
    const rule = makeRule({ policyType: 'safety', approverRole: undefined });
    const result = resolveApprover(rule, registry);
    expect(result?.role).toBe('ceo');
  });

  it('returns null when no approver found', () => {
    const emptyRegistry: AgentRegistryConfig = { tenantId: 'default', agents: [] };
    const rule = makeRule({ policyType: 'business', approverRole: undefined });
    const result = resolveApprover(rule, emptyRegistry);
    expect(result).toBeNull();
  });
});

describe('checkSeparationOfDuties', () => {
  it('allows different requester and resolver', () => {
    const result = checkSeparationOfDuties('ops-agent', 'product-agent', ['product_manager']);
    expect(result.allowed).toBe(true);
  });

  it('denies self-approval without break-glass', () => {
    const result = checkSeparationOfDuties('ops-agent', 'ops-agent', ['ops_manager']);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Separation of duties');
  });

  it('denies self-approval break-glass without CEO role', () => {
    const result = checkSeparationOfDuties('ops-agent', 'ops-agent', ['ops_manager'], {
      reason: 'Emergency',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('CEO role');
  });

  it('denies self-approval break-glass without reason', () => {
    const result = checkSeparationOfDuties('ceo-agent', 'ceo-agent', ['ceo'], {
      reason: '',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('explicit reason');
  });

  it('denies self-approval break-glass with expired timestamp', () => {
    const result = checkSeparationOfDuties('ceo-agent', 'ceo-agent', ['ceo'], {
      reason: 'Emergency override',
      expiresAt: '2020-01-01T00:00:00Z',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('future expiry');
  });

  it('allows self-approval with valid break-glass', () => {
    const result = checkSeparationOfDuties('ceo-agent', 'ceo-agent', ['ceo'], {
      reason: 'Emergency override — all other approvers unavailable',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(result.allowed).toBe(true);
  });
});
