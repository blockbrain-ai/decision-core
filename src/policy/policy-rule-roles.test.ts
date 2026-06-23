import { describe, it, expect } from 'vitest';
import { evaluateRule } from './policy-rule.entity.js';
import type { PolicyRule, PolicyContext } from '../contracts/policy.contracts.js';

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    description: 'A test rule',
    actionTypePattern: '**',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'safety',
    priority: 10,
    requiredConstraints: [],
    requireApproval: false,
    enabled: true,
    tenantId: 'tenant-1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    enforcementPoint: 'pre_decision',
    actionType: 'approve_purchase',
    ...overrides,
  };
}

describe('evaluateRule — role checks', () => {
  it('rule with requiredRoles passes when caller has matching role (any mode)', () => {
    const rule = makeRule({
      requiredRoles: ['finance_approver', 'ceo'],
      roleMatchMode: 'any',
      defaultVerdict: 'allow',
    });
    const ctx = makeContext({ callerRoles: ['finance_approver'] });
    const result = evaluateRule(rule, ctx);
    expect(result.applies).toBe(true);
    expect(result.verdict).toBe('allow');
  });

  it('rule with requiredRoles does not apply when caller lacks roles (any mode)', () => {
    const rule = makeRule({
      requiredRoles: ['finance_approver', 'ceo'],
      roleMatchMode: 'any',
    });
    const ctx = makeContext({ callerRoles: ['ops_manager'] });
    const result = evaluateRule(rule, ctx);
    expect(result.applies).toBe(false);
    expect(result.reason).toContain('Caller lacks required roles');
  });

  it('rule with requiredRoles does not apply when caller has no roles', () => {
    const rule = makeRule({ requiredRoles: ['finance_approver'] });
    const ctx = makeContext();
    const result = evaluateRule(rule, ctx);
    expect(result.applies).toBe(false);
    expect(result.reason).toContain('Caller has no roles');
  });

  it('rule with requiredRoles does not apply when callerRoles is empty array', () => {
    const rule = makeRule({ requiredRoles: ['finance_approver'] });
    const ctx = makeContext({ callerRoles: [] });
    const result = evaluateRule(rule, ctx);
    expect(result.applies).toBe(false);
  });

  it('roleMatchMode "all" requires every role', () => {
    const rule = makeRule({
      requiredRoles: ['finance_approver', 'budget_viewer'],
      roleMatchMode: 'all',
      defaultVerdict: 'allow',
    });

    const ctxBoth = makeContext({ callerRoles: ['finance_approver', 'budget_viewer'] });
    expect(evaluateRule(rule, ctxBoth).applies).toBe(true);

    const ctxOne = makeContext({ callerRoles: ['finance_approver'] });
    expect(evaluateRule(rule, ctxOne).applies).toBe(false);
  });

  it('default roleMatchMode is "any"', () => {
    const rule = makeRule({
      requiredRoles: ['finance_approver', 'ceo'],
      defaultVerdict: 'allow',
    });
    const ctx = makeContext({ callerRoles: ['ceo'] });
    const result = evaluateRule(rule, ctx);
    expect(result.applies).toBe(true);
  });

  it('rule without requiredRoles applies to all callers (backward compatible)', () => {
    const rule = makeRule({ defaultVerdict: 'allow' });
    const ctx = makeContext({ callerRoles: ['anything'] });
    const result = evaluateRule(rule, ctx);
    expect(result.applies).toBe(true);
    expect(result.verdict).toBe('allow');
  });

  it('rule without requiredRoles applies when caller has no roles (backward compatible)', () => {
    const rule = makeRule({ defaultVerdict: 'allow' });
    const ctx = makeContext();
    const result = evaluateRule(rule, ctx);
    expect(result.applies).toBe(true);
    expect(result.verdict).toBe('allow');
  });
});
