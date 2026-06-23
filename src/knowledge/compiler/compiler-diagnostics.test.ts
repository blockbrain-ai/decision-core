import { describe, it, expect } from 'vitest';
import { createCompiledRuleEvaluator } from './compiled-rule-evaluator.js';
import type { CompiledRule } from './policy-rule-expression.types.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

function makeRule(overrides: Partial<CompiledRule> & Pick<CompiledRule, 'expression' | 'ruleType'>): CompiledRule {
  return {
    id: 'test-rule',
    clauseId: 'test-clause',
    controlId: null,
    description: 'test',
    compiledAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('EvalDiagnostic', () => {
  const evaluator = createCompiledRuleEvaluator();

  describe('threshold diagnostics', () => {
    const rule = makeRule({
      ruleType: 'threshold',
      expression: { type: 'threshold', field: 'amount', operator: 'gte', value: 10000 },
    });

    it('includes field, value, operator on pass', () => {
      const result = evaluator.evaluate(rule, { amount: 15000 });
      expect(result.passed).toBe(true);
      expect(result.diagnostic).toBeDefined();
      expect(result.diagnostic!.expressionType).toBe('threshold');
      expect(result.diagnostic!.fieldChecked).toBe('amount');
      expect(result.diagnostic!.valueFound).toBe(15000);
      expect(result.diagnostic!.valueExpected).toBe(10000);
      expect(result.diagnostic!.operator).toBe('gte');
      expect(result.diagnostic!.reason).toContain('pass');
      expect(result.conditionHash).toBe(hashCanonicalJson(rule.expression));
    });

    it('includes diagnostic on fail', () => {
      const result = evaluator.evaluate(rule, { amount: 500 });
      expect(result.passed).toBe(false);
      expect(result.diagnostic!.reason).toContain('fail');
    });

    it('diagnoses non-numeric field', () => {
      const result = evaluator.evaluate(rule, { amount: 'not-a-number' });
      expect(result.passed).toBe(false);
      expect(result.diagnostic!.reason).toContain('not a number');
    });
  });

  describe('enum_match diagnostics', () => {
    const rule = makeRule({
      ruleType: 'enum_match',
      expression: { type: 'enum_match', field: 'status', allowedValues: ['active', 'pending'] },
    });

    it('reports value in allowed set', () => {
      const result = evaluator.evaluate(rule, { status: 'active' });
      expect(result.diagnostic!.reason).toContain('in');
      expect(result.diagnostic!.valueFound).toBe('active');
    });

    it('reports value not in allowed set', () => {
      const result = evaluator.evaluate(rule, { status: 'closed' });
      expect(result.diagnostic!.reason).toContain('not in');
    });
  });

  describe('composite_and diagnostics', () => {
    const rule = makeRule({
      ruleType: 'composite_and',
      expression: {
        type: 'composite_and',
        rules: [
          { type: 'threshold', field: 'amount', operator: 'gte', value: 100 },
          { type: 'enum_match', field: 'currency', allowedValues: ['USD', 'EUR'] },
        ],
      },
    });

    it('includes sub-diagnostics for each rule', () => {
      const result = evaluator.evaluate(rule, { amount: 200, currency: 'USD' });
      expect(result.passed).toBe(true);
      expect(result.diagnostic!.expressionType).toBe('composite_and');
      expect(result.diagnostic!.subDiagnostics).toHaveLength(2);
      expect(result.diagnostic!.subDiagnostics![0].expressionType).toBe('threshold');
      expect(result.diagnostic!.subDiagnostics![1].expressionType).toBe('enum_match');
    });

    it('shows failure in sub-diagnostics', () => {
      const result = evaluator.evaluate(rule, { amount: 200, currency: 'GBP' });
      expect(result.passed).toBe(false);
      expect(result.diagnostic!.subDiagnostics![1].reason).toContain('not in');
    });
  });

  describe('field_presence diagnostics', () => {
    const rule = makeRule({
      ruleType: 'field_presence',
      expression: { type: 'field_presence', fields: ['name', 'email', 'phone'], allRequired: true },
    });

    it('reports missing fields', () => {
      const result = evaluator.evaluate(rule, { name: 'John', email: 'john@example.com' });
      expect(result.passed).toBe(false);
      expect(result.diagnostic!.reason).toContain('phone');
    });

    it('reports all present', () => {
      const result = evaluator.evaluate(rule, { name: 'John', email: 'j@e.com', phone: '555' });
      expect(result.passed).toBe(true);
      expect(result.diagnostic!.reason).toContain('present');
    });
  });

  describe('range diagnostics', () => {
    const rule = makeRule({
      ruleType: 'range',
      expression: { type: 'range', field: 'score', min: 0, max: 100, inclusive: true },
    });

    it('includes range bounds', () => {
      const result = evaluator.evaluate(rule, { score: 50 });
      expect(result.diagnostic!.reason).toContain('50');
      expect(result.diagnostic!.reason).toContain('pass');
    });
  });

  describe('boolean_required diagnostics', () => {
    const rule = makeRule({
      ruleType: 'boolean_required',
      expression: { type: 'boolean_required', field: 'confirmed', requiredValue: true },
    });

    it('reports boolean mismatch', () => {
      const result = evaluator.evaluate(rule, { confirmed: false });
      expect(result.diagnostic!.valueFound).toBe(false);
      expect(result.diagnostic!.valueExpected).toBe(true);
    });
  });

  it('always produces a diagnostic for every evaluation', () => {
    const expressionTypes: CompiledRule[] = [
      makeRule({ ruleType: 'threshold', expression: { type: 'threshold', field: 'x', operator: 'gt', value: 0 } }),
      makeRule({ ruleType: 'range', expression: { type: 'range', field: 'x', min: 0, max: 10, inclusive: true } }),
      makeRule({ ruleType: 'enum_match', expression: { type: 'enum_match', field: 'x', allowedValues: ['a'] } }),
      makeRule({ ruleType: 'string_match', expression: { type: 'string_match', field: 'x', pattern: 'a', caseSensitive: true } }),
      makeRule({ ruleType: 'boolean_required', expression: { type: 'boolean_required', field: 'x', requiredValue: true } }),
      makeRule({ ruleType: 'field_presence', expression: { type: 'field_presence', fields: ['x'], allRequired: true } }),
      makeRule({ ruleType: 'regex_match', expression: { type: 'regex_match', field: 'x', pattern: '.*' } }),
      makeRule({ ruleType: 'amount_limit', expression: { type: 'amount_limit', field: 'x', maxAmount: 100 } }),
      makeRule({ ruleType: 'count_limit', expression: { type: 'count_limit', field: 'x', maxCount: 10 } }),
      makeRule({ ruleType: 'jurisdiction_match', expression: { type: 'jurisdiction_match', field: 'x', allowedJurisdictions: ['US'] } }),
    ];

    for (const rule of expressionTypes) {
      const result = evaluator.evaluate(rule, { x: 5 });
      expect(result.diagnostic).toBeDefined();
      expect(result.diagnostic!.expressionType).toBe(rule.ruleType);
      expect(result.diagnostic!.ruleId).toBe('test-rule');
    }
  });
});
