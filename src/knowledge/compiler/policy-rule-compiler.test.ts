/**
 * Tests for Policy Rule Compiler
 *
 * Covers all 16 rule types, ambiguity detection, draft rejection,
 * rule set versioning, and the test harness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyControl } from '../../contracts/clause.contracts.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';
import { InMemoryClauseRepository } from '../../persistence/memory/in-memory-clause.repository.js';
import { InMemoryCompiledRuleSetRepository } from '../../persistence/memory/in-memory-compiled-rule-set.repository.js';
import { createPolicyRuleCompiler } from './policy-rule-compiler.service.js';
import type { ControlProvider, StructuredCompilerInputProvider } from './policy-rule-compiler.service.js';
import { createCompiledRuleEvaluator } from './compiled-rule-evaluator.js';
import { createVersionedRuleSetRepository, computeRuleSetHash } from './compiled-rule-set.repository.js';
import { createPolicyRuleTestHarness } from './policy-rule-test-harness.js';
import type { CompiledRule, DecisionContext, RuleExpression } from './policy-rule-expression.types.js';

const TENANT = 'test-tenant' as TenantId;


function makeControl(overrides?: Partial<PolicyControl>): PolicyControl {
  return {
    id: 'ctrl-1',
    tenantId: TENANT,
    clauseId: 'clause-1',
    controlType: 'amount_threshold',
    parameters: { field: 'amount', maxAmount: 10000 },
    correlationId: 'corr-1',
    auditHash: 'audit-ctrl-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCompiledRule(expression: RuleExpression, overrides?: Partial<CompiledRule>): CompiledRule {
  return {
    id: 'rule-1',
    clauseId: 'clause-1',
    controlId: 'ctrl-1',
    ruleType: expression.type as CompiledRule['ruleType'],
    expression,
    description: 'Test rule',
    compiledAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Simple in-memory control provider for tests
class InMemoryControlProvider implements ControlProvider {
  private controls: PolicyControl[] = [];

  add(control: PolicyControl): void {
    this.controls.push(control);
  }

  async findByClauseId(_tenantId: TenantId, clauseId: string): Promise<PolicyControl[]> {
    return this.controls.filter((c) => c.clauseId === clauseId);
  }
}

// ===========================================================================
// Evaluator Tests — All 16 Rule Types
// ===========================================================================

describe('CompiledRuleEvaluator', () => {
  const evaluator = createCompiledRuleEvaluator();

  describe('threshold', () => {
    it('passes when value satisfies operator', () => {
      const rule = makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 });
      const result = evaluator.evaluate(rule, { amount: 5000 });
      expect(result.passed).toBe(true);
      expect(result.result).toBe('pass');
    });

    it('fails when value does not satisfy operator', () => {
      const rule = makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 });
      const result = evaluator.evaluate(rule, { amount: 15000 });
      expect(result.passed).toBe(false);
      expect(result.result).toBe('fail');
    });

    it('handles gt operator', () => {
      const rule = makeCompiledRule({ type: 'threshold', field: 'score', operator: 'gt', value: 50 });
      expect(evaluator.evaluate(rule, { score: 75 }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { score: 50 }).passed).toBe(false);
    });

    it('handles gte operator', () => {
      const rule = makeCompiledRule({ type: 'threshold', field: 'score', operator: 'gte', value: 50 });
      expect(evaluator.evaluate(rule, { score: 50 }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { score: 49 }).passed).toBe(false);
    });

    it('handles eq operator', () => {
      const rule = makeCompiledRule({ type: 'threshold', field: 'code', operator: 'eq', value: 200 });
      expect(evaluator.evaluate(rule, { code: 200 }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { code: 404 }).passed).toBe(false);
    });

    it('handles neq operator', () => {
      const rule = makeCompiledRule({ type: 'threshold', field: 'code', operator: 'neq', value: 0 });
      expect(evaluator.evaluate(rule, { code: 1 }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { code: 0 }).passed).toBe(false);
    });

    it('fails when field is not a number', () => {
      const rule = makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 });
      expect(evaluator.evaluate(rule, { amount: 'abc' }).passed).toBe(false);
    });
  });

  describe('range', () => {
    it('passes when value is within inclusive range', () => {
      const rule = makeCompiledRule({ type: 'range', field: 'age', min: 18, max: 65, inclusive: true });
      expect(evaluator.evaluate(rule, { age: 18 }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { age: 65 }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { age: 40 }).passed).toBe(true);
    });

    it('fails when value is outside inclusive range', () => {
      const rule = makeCompiledRule({ type: 'range', field: 'age', min: 18, max: 65, inclusive: true });
      expect(evaluator.evaluate(rule, { age: 17 }).passed).toBe(false);
      expect(evaluator.evaluate(rule, { age: 66 }).passed).toBe(false);
    });

    it('handles exclusive range', () => {
      const rule = makeCompiledRule({ type: 'range', field: 'temp', min: 0, max: 100, inclusive: false });
      expect(evaluator.evaluate(rule, { temp: 0 }).passed).toBe(false);
      expect(evaluator.evaluate(rule, { temp: 100 }).passed).toBe(false);
      expect(evaluator.evaluate(rule, { temp: 50 }).passed).toBe(true);
    });
  });

  describe('enum_match', () => {
    it('passes when value is in allowed set', () => {
      const rule = makeCompiledRule({
        type: 'enum_match', field: 'status', allowedValues: ['active', 'pending'],
      });
      expect(evaluator.evaluate(rule, { status: 'active' }).passed).toBe(true);
    });

    it('fails when value is not in allowed set', () => {
      const rule = makeCompiledRule({
        type: 'enum_match', field: 'status', allowedValues: ['active', 'pending'],
      });
      expect(evaluator.evaluate(rule, { status: 'cancelled' }).passed).toBe(false);
    });
  });

  describe('string_match', () => {
    it('passes with case-sensitive match', () => {
      const rule = makeCompiledRule({
        type: 'string_match', field: 'name', pattern: 'Alice', caseSensitive: true,
      });
      expect(evaluator.evaluate(rule, { name: 'Alice' }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { name: 'alice' }).passed).toBe(false);
    });

    it('passes with case-insensitive match', () => {
      const rule = makeCompiledRule({
        type: 'string_match', field: 'name', pattern: 'Alice', caseSensitive: false,
      });
      expect(evaluator.evaluate(rule, { name: 'alice' }).passed).toBe(true);
    });
  });

  describe('boolean_required', () => {
    it('passes when field matches required value', () => {
      const rule = makeCompiledRule({
        type: 'boolean_required', field: 'consent', requiredValue: true,
      });
      expect(evaluator.evaluate(rule, { consent: true }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { consent: false }).passed).toBe(false);
    });
  });

  describe('field_presence', () => {
    it('passes when all required fields are present', () => {
      const rule = makeCompiledRule({
        type: 'field_presence', fields: ['name', 'email'], allRequired: true,
      });
      expect(evaluator.evaluate(rule, { name: 'Alice', email: 'a@b.c' }).passed).toBe(true);
    });

    it('fails when a required field is missing', () => {
      const rule = makeCompiledRule({
        type: 'field_presence', fields: ['name', 'email'], allRequired: true,
      });
      expect(evaluator.evaluate(rule, { name: 'Alice' }).passed).toBe(false);
    });

    it('passes with anyOf when at least one field present', () => {
      const rule = makeCompiledRule({
        type: 'field_presence', fields: ['phone', 'email'], allRequired: false,
      });
      expect(evaluator.evaluate(rule, { email: 'a@b.c' }).passed).toBe(true);
    });
  });

  describe('sanctions_match', () => {
    it('passes when entity not on sanctions list', () => {
      const rule = makeCompiledRule({
        type: 'sanctions_match', field: 'entity', sanctionsLists: ['OFAC'],
      });
      const ctx: DecisionContext = {
        entity: 'Good Corp',
        _sanctionsData: { OFAC: ['Bad Corp'] },
      };
      expect(evaluator.evaluate(rule, ctx).passed).toBe(true);
    });

    it('fails when entity is on sanctions list', () => {
      const rule = makeCompiledRule({
        type: 'sanctions_match', field: 'entity', sanctionsLists: ['OFAC'],
      });
      const ctx: DecisionContext = {
        entity: 'Bad Corp',
        _sanctionsData: { OFAC: ['Bad Corp'] },
      };
      expect(evaluator.evaluate(rule, ctx).passed).toBe(false);
    });

    it('passes when no sanctions data available', () => {
      const rule = makeCompiledRule({
        type: 'sanctions_match', field: 'entity', sanctionsLists: ['OFAC'],
      });
      expect(evaluator.evaluate(rule, { entity: 'Any Corp' }).passed).toBe(true);
    });
  });

  describe('regex_match', () => {
    it('passes when value matches regex', () => {
      const rule = makeCompiledRule({
        type: 'regex_match', field: 'code', pattern: '^[A-Z]{2}\\d{4}$',
      });
      expect(evaluator.evaluate(rule, { code: 'AB1234' }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { code: 'ab1234' }).passed).toBe(false);
    });

    it('respects flags', () => {
      const rule = makeCompiledRule({
        type: 'regex_match', field: 'code', pattern: '^[a-z]+$', flags: 'i',
      });
      expect(evaluator.evaluate(rule, { code: 'ABC' }).passed).toBe(true);
    });
  });

  describe('date_range', () => {
    it('passes when date is within range', () => {
      const rule = makeCompiledRule({
        type: 'date_range', field: 'createdAt', after: '2024-01-01', before: '2025-01-01',
      });
      expect(evaluator.evaluate(rule, { createdAt: '2024-06-15' }).passed).toBe(true);
    });

    it('fails when date is before range start', () => {
      const rule = makeCompiledRule({
        type: 'date_range', field: 'createdAt', after: '2024-01-01', before: '2025-01-01',
      });
      expect(evaluator.evaluate(rule, { createdAt: '2023-12-31' }).passed).toBe(false);
    });

    it('handles null boundaries (open-ended)', () => {
      const rule = makeCompiledRule({
        type: 'date_range', field: 'createdAt', after: '2024-01-01', before: null,
      });
      expect(evaluator.evaluate(rule, { createdAt: '2030-01-01' }).passed).toBe(true);
    });
  });

  describe('amount_limit', () => {
    it('passes when amount is within limit', () => {
      const rule = makeCompiledRule({
        type: 'amount_limit', field: 'total', maxAmount: 50000,
      });
      expect(evaluator.evaluate(rule, { total: 30000 }).passed).toBe(true);
    });

    it('fails when amount exceeds limit', () => {
      const rule = makeCompiledRule({
        type: 'amount_limit', field: 'total', maxAmount: 50000,
      });
      expect(evaluator.evaluate(rule, { total: 60000 }).passed).toBe(false);
    });

    it('checks currency when specified', () => {
      const rule = makeCompiledRule({
        type: 'amount_limit', field: 'total', maxAmount: 50000, currency: 'USD',
      });
      expect(evaluator.evaluate(rule, { total: 30000, total_currency: 'USD' }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { total: 30000, total_currency: 'EUR' }).passed).toBe(false);
    });
  });

  describe('count_limit', () => {
    it('passes when count is within limit', () => {
      const rule = makeCompiledRule({
        type: 'count_limit', field: 'attempts', maxCount: 3,
      });
      expect(evaluator.evaluate(rule, { attempts: 2 }).passed).toBe(true);
    });

    it('fails when count exceeds limit', () => {
      const rule = makeCompiledRule({
        type: 'count_limit', field: 'attempts', maxCount: 3,
      });
      expect(evaluator.evaluate(rule, { attempts: 5 }).passed).toBe(false);
    });
  });

  describe('role_required', () => {
    it('passes when all required roles present', () => {
      const rule = makeCompiledRule({
        type: 'role_required', field: 'roles', requiredRoles: ['admin', 'reviewer'], anyOf: false,
      });
      expect(evaluator.evaluate(rule, { roles: ['admin', 'reviewer', 'user'] }).passed).toBe(true);
    });

    it('fails when not all required roles present', () => {
      const rule = makeCompiledRule({
        type: 'role_required', field: 'roles', requiredRoles: ['admin', 'reviewer'], anyOf: false,
      });
      expect(evaluator.evaluate(rule, { roles: ['admin'] }).passed).toBe(false);
    });

    it('passes with anyOf when at least one role present', () => {
      const rule = makeCompiledRule({
        type: 'role_required', field: 'roles', requiredRoles: ['admin', 'reviewer'], anyOf: true,
      });
      expect(evaluator.evaluate(rule, { roles: ['reviewer'] }).passed).toBe(true);
    });
  });

  describe('jurisdiction_match', () => {
    it('passes when jurisdiction is in allowed list', () => {
      const rule = makeCompiledRule({
        type: 'jurisdiction_match', field: 'country', allowedJurisdictions: ['US', 'UK', 'AU'],
      });
      expect(evaluator.evaluate(rule, { country: 'US' }).passed).toBe(true);
    });

    it('fails when jurisdiction is not in allowed list', () => {
      const rule = makeCompiledRule({
        type: 'jurisdiction_match', field: 'country', allowedJurisdictions: ['US', 'UK', 'AU'],
      });
      expect(evaluator.evaluate(rule, { country: 'RU' }).passed).toBe(false);
    });
  });

  describe('list_membership', () => {
    it('passes when entity is on required list', () => {
      const rule = makeCompiledRule({
        type: 'list_membership', field: 'vendor', listId: 'approved_vendors', mustBePresent: true,
      });
      const ctx: DecisionContext = {
        vendor: 'Acme',
        _listData: { approved_vendors: ['Acme', 'BobCo'] },
      };
      expect(evaluator.evaluate(rule, ctx).passed).toBe(true);
    });

    it('fails when entity is not on required list', () => {
      const rule = makeCompiledRule({
        type: 'list_membership', field: 'vendor', listId: 'approved_vendors', mustBePresent: true,
      });
      const ctx: DecisionContext = {
        vendor: 'Unknown',
        _listData: { approved_vendors: ['Acme', 'BobCo'] },
      };
      expect(evaluator.evaluate(rule, ctx).passed).toBe(false);
    });

    it('passes when entity is NOT on exclusion list (mustBePresent: false)', () => {
      const rule = makeCompiledRule({
        type: 'list_membership', field: 'vendor', listId: 'blocked_vendors', mustBePresent: false,
      });
      const ctx: DecisionContext = {
        vendor: 'GoodCo',
        _listData: { blocked_vendors: ['BadCo'] },
      };
      expect(evaluator.evaluate(rule, ctx).passed).toBe(true);
    });
  });

  describe('composite_and', () => {
    it('passes when all sub-rules pass', () => {
      const rule = makeCompiledRule({
        type: 'composite_and',
        rules: [
          { type: 'threshold', field: 'amount', operator: 'lte', value: 10000 },
          { type: 'boolean_required', field: 'consent', requiredValue: true },
        ],
      });
      expect(evaluator.evaluate(rule, { amount: 5000, consent: true }).passed).toBe(true);
    });

    it('fails when any sub-rule fails', () => {
      const rule = makeCompiledRule({
        type: 'composite_and',
        rules: [
          { type: 'threshold', field: 'amount', operator: 'lte', value: 10000 },
          { type: 'boolean_required', field: 'consent', requiredValue: true },
        ],
      });
      expect(evaluator.evaluate(rule, { amount: 5000, consent: false }).passed).toBe(false);
    });
  });

  describe('composite_or', () => {
    it('passes when at least one sub-rule passes', () => {
      const rule = makeCompiledRule({
        type: 'composite_or',
        rules: [
          { type: 'threshold', field: 'amount', operator: 'lte', value: 1000 },
          { type: 'role_required', field: 'roles', requiredRoles: ['admin'], anyOf: true },
        ],
      });
      expect(evaluator.evaluate(rule, { amount: 50000, roles: ['admin'] }).passed).toBe(true);
    });

    it('fails when all sub-rules fail', () => {
      const rule = makeCompiledRule({
        type: 'composite_or',
        rules: [
          { type: 'threshold', field: 'amount', operator: 'lte', value: 1000 },
          { type: 'role_required', field: 'roles', requiredRoles: ['admin'], anyOf: true },
        ],
      });
      expect(evaluator.evaluate(rule, { amount: 50000, roles: ['user'] }).passed).toBe(false);
    });
  });

  describe('nested field access', () => {
    it('supports dot-notation field paths', () => {
      const rule = makeCompiledRule({
        type: 'threshold', field: 'payment.amount', operator: 'lte', value: 500,
      });
      expect(evaluator.evaluate(rule, { payment: { amount: 300 } }).passed).toBe(true);
      expect(evaluator.evaluate(rule, { payment: { amount: 700 } }).passed).toBe(false);
    });
  });

  describe('evaluateAll', () => {
    it('evaluates multiple rules and returns all results', () => {
      const rules = [
        makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
        makeCompiledRule({ type: 'boolean_required', field: 'consent', requiredValue: true }, { id: 'r2' }),
      ];
      const results = evaluator.evaluateAll(rules, { amount: 5000, consent: false });
      expect(results).toHaveLength(2);
      expect(results[0]!.passed).toBe(true);
      expect(results[1]!.passed).toBe(false);
    });
  });
});

// ===========================================================================
// Compiler Service Tests
// ===========================================================================

describe('PolicyRuleCompiler', () => {
  let clauseRepo: InMemoryClauseRepository;
  let controlProvider: InMemoryControlProvider;
  let compiler: ReturnType<typeof createPolicyRuleCompiler>;

  beforeEach(() => {
    clauseRepo = new InMemoryClauseRepository();
    controlProvider = new InMemoryControlProvider();
    compiler = createPolicyRuleCompiler(clauseRepo as unknown as ClauseRepository, controlProvider);
  });

  it('compiles a clause with amount_threshold control', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c1',
      text: 'Transactions must not exceed $10,000',
      clauseType: 'threshold',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'approved',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-1',
    });
    controlProvider.add(makeControl({ clauseId: clause.id }));

    const result = await compiler.compile(TENANT, [clause.id]);

    expect(result.compiledRules).toHaveLength(1);
    expect(result.compiledRules[0]!.ruleType).toBe('amount_limit');
    expect(result.ambiguousClauses).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects draft clauses', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c2',
      text: 'Some draft rule',
      clauseType: 'obligation',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'draft',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-2',
    });

    const result = await compiler.compile(TENANT, [clause.id]);

    expect(result.compiledRules).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('draft');
  });

  it('produces needs_human_policy_authoring for ambiguous clauses', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c3',
      text: 'The organization shall maintain appropriate safeguards.',
      clauseType: 'general',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'approved',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-3',
    });

    const result = await compiler.compile(TENANT, [clause.id]);

    expect(result.compiledRules).toHaveLength(0);
    expect(result.ambiguousClauses).toHaveLength(1);
    expect(result.ambiguousClauses[0]!.status).toBe('needs_human_policy_authoring');
    expect(result.ambiguousClauses[0]!.clauseId).toBe(clause.id);
  });

  it('compiles active clauses (not just approved)', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c4',
      text: 'Active threshold rule',
      clauseType: 'threshold',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'active',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-4',
    });
    controlProvider.add(makeControl({
      id: 'ctrl-4',
      clauseId: clause.id,
      parameters: { field: 'amount', operator: 'lte', value: 5000 },
    }));

    const result = await compiler.compile(TENANT, [clause.id]);
    expect(result.compiledRules).toHaveLength(1);
    expect(result.compiledRules[0]!.ruleType).toBe('threshold');
  });

  it('rejects superseded clauses', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c5',
      text: 'Old rule',
      clauseType: 'obligation',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'superseded',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-5',
    });

    const result = await compiler.compile(TENANT, [clause.id]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('superseded');
  });

  it('handles missing clauses gracefully', async () => {
    const result = await compiler.compile(TENANT, ['nonexistent-id']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('not found');
  });

  it('compiles sanctions_hold control', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c6',
      text: 'Check all entities against sanctions lists',
      clauseType: 'obligation',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'approved',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-6',
    });
    controlProvider.add(makeControl({
      id: 'ctrl-6',
      clauseId: clause.id,
      controlType: 'sanctions_hold',
      parameters: { field: 'counterparty', sanctionsLists: ['OFAC', 'EU'] },
    }));

    const result = await compiler.compile(TENANT, [clause.id]);
    expect(result.compiledRules).toHaveLength(1);
    expect(result.compiledRules[0]!.ruleType).toBe('sanctions_match');
  });

  it('compiles evidence_field_required control', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c7',
      text: 'Evidence must include KYC documents',
      clauseType: 'evidence_requirement',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'approved',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-7',
    });
    controlProvider.add(makeControl({
      id: 'ctrl-7',
      clauseId: clause.id,
      controlType: 'evidence_field_required',
      parameters: { fields: ['kyc_document', 'id_verification'] },
    }));

    const result = await compiler.compile(TENANT, [clause.id]);
    expect(result.compiledRules).toHaveLength(1);
    expect(result.compiledRules[0]!.ruleType).toBe('field_presence');
  });

  it('compiles dual_authorization_required control', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c8',
      text: 'Dual authorization required',
      clauseType: 'approval_requirement',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'approved',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-8',
    });
    controlProvider.add(makeControl({
      id: 'ctrl-8',
      clauseId: clause.id,
      controlType: 'dual_authorization_required',
      parameters: { field: 'approvers', requiredRoles: ['manager', 'compliance_officer'] },
    }));

    const result = await compiler.compile(TENANT, [clause.id]);
    expect(result.compiledRules).toHaveLength(1);
    expect(result.compiledRules[0]!.ruleType).toBe('role_required');
  });

  it('compiles decision_label_forbidden — rule fails when value IS forbidden', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'pol/sec/c9',
      text: 'Decision labels auto_approve and bypass are forbidden',
      clauseType: 'prohibition',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'approved',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-9',
    });
    controlProvider.add(makeControl({
      id: 'ctrl-9',
      clauseId: clause.id,
      controlType: 'decision_label_forbidden',
      parameters: { field: 'decision_label', forbiddenValues: ['auto_approve', 'bypass'] },
    }));

    const result = await compiler.compile(TENANT, [clause.id]);
    expect(result.compiledRules).toHaveLength(1);
    expect(result.compiledRules[0]!.ruleType).toBe('list_membership');

    // Verify the compiled rule correctly FAILS for forbidden values
    const evaluator = createCompiledRuleEvaluator();
    const rule = result.compiledRules[0]!;
    // Context with the forbidden list data
    const ctx = (label: string): DecisionContext => ({
      decision_label: label,
      _listData: { _forbidden_decision_labels: ['auto_approve', 'bypass'] },
    });

    // Forbidden value → rule FAILS (correctly denies)
    expect(evaluator.evaluate(rule, ctx('auto_approve')).passed).toBe(false);
    expect(evaluator.evaluate(rule, ctx('bypass')).passed).toBe(false);
    // Allowed value → rule PASSES
    expect(evaluator.evaluate(rule, ctx('manual_review')).passed).toBe(true);
  });

  it('compiles exact structured compiler input without controls or prose pattern matching', async () => {
    const clause = await clauseRepo.create(TENANT, {
      clauseKey: 'structured/c1',
      text: '[structured] dc.structured.001',
      clauseType: 'general',
      sectionId: 's1',
      sourceDocumentId: 'd1',
      status: 'approved',
      effectiveDate: null,
      expiryDate: null,
      correlationId: 'corr-structured',
    });

    const structuredInputProvider: StructuredCompilerInputProvider = {
      async findByClauseId(_tenantId, clauseId) {
        if (clauseId !== clause.id) return null;
        return {
          clauseId,
          clauseType: 'general',
          expression: { type: 'boolean_required', field: 'approved', requiredValue: true },
          sourceLineRef: { file: 'policy.md', startLine: 12, endLine: 20 },
          surfaceId: 'workflow.routing',
          decision: 'allow',
          authoringSchemaVersion: '1.0.0',
        };
      },
    };

    const structuredCompiler = createPolicyRuleCompiler(
      clauseRepo as unknown as ClauseRepository,
      controlProvider,
      { structuredInputProvider },
    );

    const result = await structuredCompiler.compile(TENANT, [clause.id]);

    expect(result.errors).toHaveLength(0);
    expect(result.ambiguousClauses).toHaveLength(0);
    expect(result.compiledRules).toHaveLength(1);
    expect(result.compiledRules[0]).toMatchObject({
      clauseId: clause.id,
      controlId: null,
      ruleType: 'boolean_required',
      expression: { type: 'boolean_required', field: 'approved', requiredValue: true },
      sourceLineRef: { file: 'policy.md', startLine: 12, endLine: 20 },
      surfaceId: 'workflow.routing',
      authoringSchemaVersion: '1.0.0',
      decision: 'allow',
    });
    expect(result.diagnostics?.some((d) => d.stage === 'structured_condition' && d.outcome === 'success')).toBe(true);
    expect(result.diagnostics?.some((d) => d.stage === 'pattern_match')).toBe(false);
  });
});

// ===========================================================================
// Rule Set Repository Tests
// ===========================================================================

describe('VersionedRuleSetRepository', () => {
  let baseRepo: InMemoryCompiledRuleSetRepository;
  let versionedRepo: ReturnType<typeof createVersionedRuleSetRepository>;

  beforeEach(() => {
    baseRepo = new InMemoryCompiledRuleSetRepository();
    versionedRepo = createVersionedRuleSetRepository(baseRepo);
  });

  it('creates a versioned rule set', async () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }),
    ];
    const ruleSet = await versionedRepo.createRuleSet(TENANT, 'policy-v1', rules, ['c1'], 'corr-1');

    expect(ruleSet.version).toBe(1);
    expect(ruleSet.status).toBe('inactive');
    expect(ruleSet.name).toBe('policy-v1');
  });

  it('increments version for same name', async () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }),
    ];
    const v1 = await versionedRepo.createRuleSet(TENANT, 'policy-v1', rules, ['c1'], 'corr-1');
    const v2 = await versionedRepo.createRuleSet(TENANT, 'policy-v1', rules, ['c1'], 'corr-2');

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
  });

  it('activates a rule set', async () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }),
    ];
    const ruleSet = await versionedRepo.createRuleSet(TENANT, 'policy', rules, ['c1'], 'corr-1');
    const activated = await versionedRepo.activateRuleSet(TENANT, ruleSet.id);

    expect(activated!.status).toBe('active');
    expect(activated!.activatedAt).toBeTruthy();
  });

  it('returns active rule set', async () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }),
    ];
    const ruleSet = await versionedRepo.createRuleSet(TENANT, 'policy', rules, ['c1'], 'corr-1');
    await versionedRepo.activateRuleSet(TENANT, ruleSet.id);

    const active = await versionedRepo.getActiveRuleSet(TENANT);
    expect(active!.id).toBe(ruleSet.id);
  });

  it('rule set hash is deterministic for same rules', () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
      makeCompiledRule({ type: 'boolean_required', field: 'consent', requiredValue: true }, { id: 'r2' }),
    ];
    const hash1 = computeRuleSetHash(rules);
    const hash2 = computeRuleSetHash(rules);
    expect(hash1).toBe(hash2);
  });

  it('rule set hash differs for different rules', () => {
    const rules1: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
    ];
    const rules2: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 20000 }, { id: 'r1' }),
    ];
    expect(computeRuleSetHash(rules1)).not.toBe(computeRuleSetHash(rules2));
  });

  it('rule set hash is order-independent', () => {
    const r1 = makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' });
    const r2 = makeCompiledRule({ type: 'boolean_required', field: 'consent', requiredValue: true }, { id: 'r2' });
    expect(computeRuleSetHash([r1, r2])).toBe(computeRuleSetHash([r2, r1]));
  });

  it('stores rule set hash on the created rule set (auditHash)', async () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
    ];
    const expectedHash = computeRuleSetHash(rules);
    const ruleSet = await versionedRepo.createRuleSet(TENANT, 'policy', rules, ['c1'], 'corr-1');

    expect(ruleSet.auditHash).toBe(expectedHash);
  });

  it('getRulesForSet returns the compiled rules for a rule set', async () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
      makeCompiledRule({ type: 'boolean_required', field: 'consent', requiredValue: true }, { id: 'r2' }),
    ];
    const ruleSet = await versionedRepo.createRuleSet(TENANT, 'policy', rules, ['c1', 'c2'], 'corr-1');

    const retrieved = versionedRepo.getRulesForSet(ruleSet.id);
    expect(retrieved).toHaveLength(2);
    expect(retrieved[0]!.id).toBe('r1');
    expect(retrieved[1]!.id).toBe('r2');
  });

  it('getRulesForSet returns empty array for unknown rule set', () => {
    expect(versionedRepo.getRulesForSet('nonexistent')).toHaveLength(0);
  });

  it('verifyRuleSetHash confirms integrity of stored rules', async () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
    ];
    const ruleSet = await versionedRepo.createRuleSet(TENANT, 'policy', rules, ['c1'], 'corr-1');

    expect(versionedRepo.verifyRuleSetHash(ruleSet.id)).toBe(true);
    expect(versionedRepo.verifyRuleSetHash('nonexistent')).toBe(false);
  });
});

// ===========================================================================
// Test Harness Tests
// ===========================================================================

describe('PolicyRuleTestHarness', () => {
  const harness = createPolicyRuleTestHarness();

  it('runs a passing test case', () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
    ];
    const result = harness.runTestCase(rules, {
      name: 'Basic threshold check',
      context: { amount: 5000 },
      expectedResults: [{ ruleId: 'r1', expectedPass: true }],
    });

    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('reports failures correctly', () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
    ];
    const result = harness.runTestCase(rules, {
      name: 'Expected pass but fails',
      context: { amount: 15000 },
      expectedResults: [{ ruleId: 'r1', expectedPass: true }],
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.expected).toBe(true);
    expect(result.failures[0]!.actual).toBe(false);
  });

  it('runs all tests and produces a report', () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
    ];
    const report = harness.runAllTests(rules, [
      {
        name: 'Pass case',
        context: { amount: 5000 },
        expectedResults: [{ ruleId: 'r1', expectedPass: true }],
      },
      {
        name: 'Fail case',
        context: { amount: 15000 },
        expectedResults: [{ ruleId: 'r1', expectedPass: true }],
      },
    ]);

    expect(report.totalTests).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.executedAt).toBeTruthy();
  });

  it('runs rules against a context and returns results', () => {
    const rules: CompiledRule[] = [
      makeCompiledRule({ type: 'threshold', field: 'amount', operator: 'lte', value: 10000 }, { id: 'r1' }),
      makeCompiledRule({ type: 'boolean_required', field: 'consent', requiredValue: true }, { id: 'r2' }),
    ];
    const results = harness.runAgainstContext(rules, { amount: 5000, consent: true });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
