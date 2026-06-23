import { describe, it, expect } from 'vitest';
import { generateScenarios } from './scenario-generator.js';
import { createCompiledRuleEvaluator } from './compiled-rule-evaluator.js';
import type { CompiledRule } from './policy-rule-expression.types.js';

function makeRule(overrides: Partial<CompiledRule> & Pick<CompiledRule, 'expression' | 'ruleType'>): CompiledRule {
  return {
    id: 'rule-1',
    clauseId: 'clause-1',
    controlId: null,
    description: 'test rule',
    compiledAt: new Date().toISOString(),
    ...overrides,
  };
}

const evaluator = createCompiledRuleEvaluator();

function verifyScenariosWork(rules: CompiledRule[]): void {
  const scenarios = generateScenarios(rules);
  expect(scenarios.length).toBeGreaterThan(0);

  for (const scenario of scenarios) {
    for (const expected of scenario.expectedResults) {
      const rule = rules.find((r) => r.id === expected.ruleId);
      if (!rule) continue;
      const result = evaluator.evaluate(rule, scenario.context);
      expect(result.passed).toBe(expected.expectedPass);
    }
  }
}

describe('generateScenarios', () => {
  it('generates threshold scenarios', () => {
    const rules = [makeRule({ ruleType: 'threshold', expression: { type: 'threshold', field: 'amount', operator: 'gte', value: 1000 } })];
    const scenarios = generateScenarios(rules);
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    verifyScenariosWork(rules);
  });

  it('generates valid threshold equality scenarios', () => {
    verifyScenariosWork([
      makeRule({ ruleType: 'threshold', expression: { type: 'threshold', field: 'amount', operator: 'eq', value: 1000 } }),
    ]);
    verifyScenariosWork([
      makeRule({ ruleType: 'threshold', expression: { type: 'threshold', field: 'amount', operator: 'neq', value: 1000 } }),
    ]);
  });

  it('generates range scenarios', () => {
    const rules = [makeRule({ ruleType: 'range', expression: { type: 'range', field: 'score', min: 0, max: 100, inclusive: true } })];
    verifyScenariosWork(rules);
  });

  it('generates enum_match scenarios', () => {
    const rules = [makeRule({ ruleType: 'enum_match', expression: { type: 'enum_match', field: 'status', allowedValues: ['active', 'pending'] } })];
    verifyScenariosWork(rules);
  });

  it('generates string_match scenarios', () => {
    const rules = [makeRule({ ruleType: 'string_match', expression: { type: 'string_match', field: 'name', pattern: 'hello', caseSensitive: false } })];
    verifyScenariosWork(rules);
  });

  it('generates boolean_required scenarios', () => {
    const rules = [makeRule({ ruleType: 'boolean_required', expression: { type: 'boolean_required', field: 'active', requiredValue: true } })];
    verifyScenariosWork(rules);
  });

  it('generates field_presence scenarios', () => {
    const rules = [makeRule({ ruleType: 'field_presence', expression: { type: 'field_presence', fields: ['name', 'email'], allRequired: true } })];
    verifyScenariosWork(rules);
  });

  it('generates amount_limit scenarios', () => {
    const rules = [makeRule({ ruleType: 'amount_limit', expression: { type: 'amount_limit', field: 'amount', maxAmount: 5000 } })];
    verifyScenariosWork(rules);
  });

  it('generates amount_limit wrong-currency scenarios', () => {
    const rules = [makeRule({ ruleType: 'amount_limit', expression: { type: 'amount_limit', field: 'amount', maxAmount: 5000, currency: 'USD' } })];
    verifyScenariosWork(rules);
    expect(generateScenarios(rules).some((scenario) => scenario.name.includes('wrong currency'))).toBe(true);
  });

  it('generates count_limit scenarios', () => {
    const rules = [makeRule({ ruleType: 'count_limit', expression: { type: 'count_limit', field: 'count', maxCount: 10 } })];
    verifyScenariosWork(rules);
  });

  it('generates role_required scenarios', () => {
    const rules = [makeRule({ ruleType: 'role_required', expression: { type: 'role_required', field: 'roles', requiredRoles: ['admin', 'approver'], anyOf: false } })];
    verifyScenariosWork(rules);
  });

  it('generates jurisdiction_match scenarios', () => {
    const rules = [makeRule({ ruleType: 'jurisdiction_match', expression: { type: 'jurisdiction_match', field: 'country', allowedJurisdictions: ['US', 'CA', 'UK'] } })];
    verifyScenariosWork(rules);
  });

  it('generates sanctions_match scenarios', () => {
    const rules = [makeRule({ ruleType: 'sanctions_match', expression: { type: 'sanctions_match', field: 'entity', sanctionsLists: ['OFAC', 'EU'] } })];
    verifyScenariosWork(rules);
  });

  it('generates list_membership scenarios (mustBePresent=true)', () => {
    const rules = [makeRule({ ruleType: 'list_membership', expression: { type: 'list_membership', field: 'item', listId: 'whitelist', mustBePresent: true } })];
    verifyScenariosWork(rules);
  });

  it('generates list_membership scenarios (mustBePresent=false)', () => {
    const rules = [makeRule({ ruleType: 'list_membership', expression: { type: 'list_membership', field: 'item', listId: 'blacklist', mustBePresent: false } })];
    verifyScenariosWork(rules);
  });

  it('generates composite_and scenarios', () => {
    const rules = [makeRule({
      ruleType: 'composite_and',
      expression: {
        type: 'composite_and',
        rules: [
          { type: 'threshold', field: 'amount', operator: 'gte', value: 100 },
          { type: 'enum_match', field: 'currency', allowedValues: ['USD', 'EUR'] },
        ],
      },
    })];
    const scenarios = generateScenarios(rules);
    expect(scenarios.length).toBeGreaterThanOrEqual(2);
  });

  it('generates composite_or scenarios', () => {
    const rules = [makeRule({
      ruleType: 'composite_or',
      expression: {
        type: 'composite_or',
        rules: [
          { type: 'threshold', field: 'amount', operator: 'gte', value: 100 },
          { type: 'boolean_required', field: 'override', requiredValue: true },
        ],
      },
    })];
    const scenarios = generateScenarios(rules);
    expect(scenarios.length).toBeGreaterThanOrEqual(2);
  });

  it('respects option flags', () => {
    const rules = [makeRule({ ruleType: 'threshold', expression: { type: 'threshold', field: 'x', operator: 'gt', value: 5 } })];
    const positiveOnly = generateScenarios(rules, { includePositive: true, includeNegative: false, includeBoundary: false, includeMissing: false });
    expect(positiveOnly.length).toBe(1);
    expect(positiveOnly[0].expectedResults[0].expectedPass).toBe(true);
  });

  it('handles multiple rules', () => {
    const rules = [
      makeRule({ id: 'r1', ruleType: 'threshold', expression: { type: 'threshold', field: 'a', operator: 'gte', value: 10 } }),
      makeRule({ id: 'r2', ruleType: 'enum_match', expression: { type: 'enum_match', field: 'b', allowedValues: ['x'] } }),
    ];
    const scenarios = generateScenarios(rules);
    const r1Scenarios = scenarios.filter((s) => s.expectedResults.some((e) => e.ruleId === 'r1'));
    const r2Scenarios = scenarios.filter((s) => s.expectedResults.some((e) => e.ruleId === 'r2'));
    expect(r1Scenarios.length).toBeGreaterThan(0);
    expect(r2Scenarios.length).toBeGreaterThan(0);
  });
});
