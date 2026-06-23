/**
 * Deterministic Enforcer Tests
 *
 * Verifies that the enforcer correctly evaluates compiled rule sets
 * and returns proper pass/fail results with clause evidence.
 */

import { describe, it, expect } from 'vitest';
import { createDeterministicEnforcer } from './deterministic-enforcer.js';
import { createCompiledRuleEvaluator } from '../compiler/compiled-rule-evaluator.js';
import type { CompiledRule, DecisionContext } from '../compiler/policy-rule-expression.types.js';
import type { VersionedRuleSetRepository } from '../compiler/compiled-rule-set.repository.js';
import type { CompiledRuleSet } from '../../contracts/clause.contracts.js';
import type { TenantId } from '../../contracts/common.contracts.js';

const TENANT = 'tenant-enf-test' as TenantId;

function makeRuleSet(id: string, version: number): CompiledRuleSet {
  return {
    id,
    tenantId: TENANT,
    name: 'test-rules',
    version,
    status: 'active',
    clauseIds: ['clause-1'],
    compiledAt: new Date().toISOString(),
    activatedAt: new Date().toISOString(),
    correlationId: 'corr-1',
    auditHash: 'hash-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeThresholdRule(id: string, clauseId: string, field: string, operator: 'lte' | 'gte', value: number): CompiledRule {
  return {
    id,
    clauseId,
    controlId: `control-${clauseId}`,
    ruleType: 'threshold',
    expression: { type: 'threshold', field, operator, value },
    description: `${field} must be ${operator} ${value}`,
    compiledAt: new Date().toISOString(),
  };
}

function makeMockRuleSetRepo(ruleSet: CompiledRuleSet | null, rules: CompiledRule[]): VersionedRuleSetRepository {
  return {
    async createRuleSet() { return ruleSet!; },
    async activateRuleSet() { return ruleSet; },
    async getActiveRuleSet() { return ruleSet; },
    async getRuleSetById() { return ruleSet; },
    getRulesForSet() { return rules; },
    async listRuleSets() { return ruleSet ? [ruleSet] : []; },
    computeRuleSetHash() { return 'hash'; },
    verifyRuleSetHash() { return true; },
  };
}

describe('DeterministicEnforcer', () => {
  const evaluator = createCompiledRuleEvaluator();

  it('passes when all rules are satisfied', async () => {
    const ruleSet = makeRuleSet('rs-1', 1);
    const rules = [
      {
        ...makeThresholdRule('rule-1', 'clause-1', 'amount', 'lte', 10000),
        sourceLineRef: { file: 'policy.md', startLine: 10, endLine: 20 },
        surfaceId: 'finance.processing',
        authoringSchemaVersion: '1.0.0',
      },
    ];
    const repo = makeMockRuleSetRepo(ruleSet, rules);
    const enforcer = createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: evaluator });

    const context: DecisionContext = { amount: 5000 };
    const result = await enforcer.enforce(TENANT, 'rs-1', context, () => 'Test clause text');

    expect(result.passed).toBe(true);
    expect(result.blockedBy).toHaveLength(0);
    expect(result.ruleSetVersion).toBe(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].clauseId).toBe('clause-1');
    expect(result.evidence[0].clauseText).toBe('Test clause text');
    expect(result.evidence[0].result).toBe('pass');
    expect(result.evidence[0].conditionHash).toBeDefined();
    expect(result.evidence[0].sourceLineRef).toEqual({ file: 'policy.md', startLine: 10, endLine: 20 });
    expect(result.evidence[0].surfaceId).toBe('finance.processing');
    expect(result.evidence[0].authoringSchemaVersion).toBe('1.0.0');
    expect(result.ruleSetHash).toBe('hash-1');
  });

  it('blocks when a rule fails and includes clause provenance', async () => {
    const ruleSet = makeRuleSet('rs-2', 2);
    const rules = [
      makeThresholdRule('rule-1', 'clause-1', 'amount', 'lte', 10000),
      makeThresholdRule('rule-2', 'clause-2', 'riskScore', 'lte', 50),
    ];
    const repo = makeMockRuleSetRepo(ruleSet, rules);
    const enforcer = createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: evaluator });

    const context: DecisionContext = { amount: 5000, riskScore: 75 };
    const clauseTexts: Record<string, string> = {
      'clause-1': 'Amount must not exceed 10000',
      'clause-2': 'Risk score must not exceed 50',
    };
    const result = await enforcer.enforce(TENANT, 'rs-2', context, (id) => clauseTexts[id] ?? '');

    expect(result.passed).toBe(false);
    expect(result.blockedBy).toHaveLength(1);
    expect(result.blockedBy[0].id).toBe('rule-2');
    expect(result.evidence).toHaveLength(2);

    const failedEvidence = result.evidence.find((e) => e.result === 'fail');
    expect(failedEvidence).toBeDefined();
    expect(failedEvidence!.clauseId).toBe('clause-2');
    expect(failedEvidence!.clauseText).toBe('Risk score must not exceed 50');
    expect(failedEvidence!.controlId).toBe('control-clause-2');
    expect(failedEvidence!.ruleType).toBe('threshold');
    expect(failedEvidence!.inputFields).toHaveProperty('riskScore', 75);
  });

  it('enforceActive returns null when no active rule set', async () => {
    const repo = makeMockRuleSetRepo(null, []);
    const enforcer = createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: evaluator });

    const result = await enforcer.enforceActive(TENANT, { amount: 100 }, () => '');
    expect(result).toBeNull();
  });

  it('enforceActive evaluates active rule set', async () => {
    const ruleSet = makeRuleSet('rs-active', 3);
    const rules = [makeThresholdRule('rule-1', 'clause-1', 'amount', 'lte', 500)];
    const repo = makeMockRuleSetRepo(ruleSet, rules);
    const enforcer = createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: evaluator });

    const result = await enforcer.enforceActive(TENANT, { amount: 1000 }, () => 'Max 500');
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.blockedBy[0].clauseId).toBe('clause-1');
  });

  it('passes with empty rule set', async () => {
    const ruleSet = makeRuleSet('rs-empty', 1);
    const repo = makeMockRuleSetRepo(ruleSet, []);
    const enforcer = createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: evaluator });

    const result = await enforcer.enforce(TENANT, 'rs-empty', { amount: 99999 }, () => '');
    expect(result.passed).toBe(true);
    expect(result.ruleResults).toHaveLength(0);
  });

  it('throws when rule set not found', async () => {
    const repo = makeMockRuleSetRepo(null, []);
    const enforcer = createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: evaluator });

    await expect(enforcer.enforce(TENANT, 'nonexistent', {}, () => '')).rejects.toThrow('Rule set not found');
  });

  it('records ruleSetVersion in result', async () => {
    const ruleSet = makeRuleSet('rs-v5', 5);
    const rules = [makeThresholdRule('rule-1', 'clause-1', 'x', 'gte', 0)];
    const repo = makeMockRuleSetRepo(ruleSet, rules);
    const enforcer = createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: evaluator });

    const result = await enforcer.enforce(TENANT, 'rs-v5', { x: 10 }, () => 'text');
    expect(result.ruleSetVersion).toBe(5);
    expect(result.ruleSetId).toBe('rs-v5');
  });
});
