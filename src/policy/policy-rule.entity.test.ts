import { describe, it, expect } from 'vitest';
import { evaluateRule, ruleAppliesToAction, ruleAppliesToEnforcementPoint } from './policy-rule.entity.js';
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
    actionType: 'finance.delete',
    ...overrides,
  };
}

describe('ruleAppliesToAction', () => {
  it('matches glob patterns', () => {
    expect(ruleAppliesToAction(makeRule({ actionTypePattern: 'finance.*' }), 'finance.delete')).toBe(true);
    expect(ruleAppliesToAction(makeRule({ actionTypePattern: 'finance.*' }), 'hr.delete')).toBe(false);
  });
});

describe('ruleAppliesToEnforcementPoint', () => {
  it('matches enforcement point', () => {
    expect(ruleAppliesToEnforcementPoint(makeRule({ enforcementPoint: 'pre_decision' }), 'pre_decision')).toBe(true);
    expect(ruleAppliesToEnforcementPoint(makeRule({ enforcementPoint: 'pre_decision' }), 'post_execution')).toBe(false);
  });
});

describe('evaluateRule', () => {
  it('returns applies=false for disabled rules', () => {
    const result = evaluateRule(makeRule({ enabled: false }), makeContext());
    expect(result.applies).toBe(false);
    expect(result.verdict).toBe('allow');
  });

  it('returns applies=false when action pattern does not match', () => {
    const result = evaluateRule(makeRule({ actionTypePattern: 'hr.*' }), makeContext({ actionType: 'finance.delete' }));
    expect(result.applies).toBe(false);
  });

  it('returns applies=false when enforcement point does not match', () => {
    const result = evaluateRule(
      makeRule({ enforcementPoint: 'post_execution' }),
      makeContext({ enforcementPoint: 'pre_decision' }),
    );
    expect(result.applies).toBe(false);
  });

  it('denies when financial impact exceeds limit', () => {
    const result = evaluateRule(
      makeRule({ maxAmountUsd: 1000 }),
      makeContext({ financialImpact: 5000 }),
    );
    expect(result.applies).toBe(true);
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('5000');
    expect(result.reason).toContain('1000');
  });

  it('returns approve_required when financial impact exceeds limit and rule requires approval', () => {
    const result = evaluateRule(
      makeRule({ maxAmountUsd: 1000, requireApproval: true }),
      makeContext({ financialImpact: 5000 }),
    );
    expect(result.applies).toBe(true);
    expect(result.verdict).toBe('approve_required');
  });

  it('denies when data quality is below minimum', () => {
    const result = evaluateRule(
      makeRule({ minDataQuality: 0.8 }),
      makeContext({ dataQualityScore: 0.5 }),
    );
    expect(result.verdict).toBe('deny');
    expect(result.applies).toBe(true);
  });

  it('denies when confidence is below minimum', () => {
    const result = evaluateRule(
      makeRule({ minConfidence: 0.9 }),
      makeContext({ confidence: 0.6 }),
    );
    expect(result.verdict).toBe('deny');
    expect(result.applies).toBe(true);
  });

  it('returns approve_required when rule requires approval and no threshold violated', () => {
    const result = evaluateRule(
      makeRule({ requireApproval: true }),
      makeContext(),
    );
    expect(result.verdict).toBe('approve_required');
    expect(result.applies).toBe(true);
  });

  it('returns allow when all checks pass', () => {
    const result = evaluateRule(
      makeRule({ maxAmountUsd: 10000 }),
      makeContext({ financialImpact: 500 }),
    );
    expect(result.verdict).toBe('allow');
    expect(result.applies).toBe(true);
  });
});
