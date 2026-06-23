/**
 * Enforcement Flow Tests
 *
 * Verifies the full enforcement pipeline: evaluates active rule set,
 * enriches clause text, records evidence, and returns correct outcomes.
 */

import { describe, it, expect } from 'vitest';
import { createEnforcementFlow } from './enforcement-flow.js';
import { createDeterministicEnforcer } from './deterministic-enforcer.js';
import { createClauseEvidenceRecorder } from './clause-evidence-recorder.js';
import { createCompiledRuleEvaluator } from '../compiler/compiled-rule-evaluator.js';
import { EvidenceRecorder } from '../../decisions/evidence/evidence-recorder.js';
import { NoOpEventService } from '../../adapters/event-service.js';
import type { CompiledRule } from '../compiler/policy-rule-expression.types.js';
import type { VersionedRuleSetRepository } from '../compiler/compiled-rule-set.repository.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';
import type { CompiledRuleSet, PolicyClause } from '../../contracts/clause.contracts.js';
import type { TenantId, CorrelationId } from '../../contracts/common.contracts.js';

const TENANT = 'tenant-flow-test' as TenantId;
const CORR = 'corr-flow-1' as CorrelationId;

function makeRuleSet(id: string): CompiledRuleSet {
  return {
    id,
    tenantId: TENANT,
    name: 'flow-rules',
    version: 1,
    status: 'active',
    clauseIds: ['clause-1'],
    compiledAt: new Date().toISOString(),
    activatedAt: new Date().toISOString(),
    correlationId: CORR,
    auditHash: 'hash',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeClause(id: string, text: string): PolicyClause {
  return {
    id,
    tenantId: TENANT,
    clauseKey: `key-${id}`,
    text,
    normalizedHash: 'nhash',
    clauseType: 'threshold',
    sectionId: 'sec-1',
    sourceDocumentId: 'doc-1',
    status: 'active',
    effectiveDate: null,
    expiryDate: null,
    correlationId: CORR,
    auditHash: 'ahash',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeMockClauseRepo(clauses: PolicyClause[]): ClauseRepository {
  return {
    async create() { return clauses[0]; },
    async findById(_t: TenantId, id: string) { return clauses.find((c) => c.id === id) ?? null; },
    async findByTenant() { return clauses; },
    async findBySourceDocument() { return clauses; },
    async findByStatus() { return clauses; },
    async update() { return clauses[0]; },
  };
}

describe('EnforcementFlow', () => {
  it('returns skipped when no active rule set', async () => {
    const repo: VersionedRuleSetRepository = {
      async createRuleSet() { return null as unknown as CompiledRuleSet; },
      async activateRuleSet() { return null; },
      async getActiveRuleSet() { return null; },
      async getRuleSetById() { return null; },
      getRulesForSet() { return []; },
      async listRuleSets() { return []; },
      computeRuleSetHash() { return ''; },
      verifyRuleSetHash() { return true; },
    };

    const enforcer = createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: createCompiledRuleEvaluator() });
    const flow = createEnforcementFlow({
      enforcer,
      clauseEvidenceRecorder: createClauseEvidenceRecorder(),
      clauseRepository: makeMockClauseRepo([]),
    });

    const evidenceRecorder = new EvidenceRecorder(TENANT, CORR, new NoOpEventService());
    const result = await flow.execute(TENANT, { actionType: 'test' }, evidenceRecorder);

    expect(result.outcome).toBe('skipped');
    expect(result.enforcementResult).toBeNull();
  });

  it('returns passed when all rules pass and records evidence', async () => {
    const ruleSet = makeRuleSet('rs-pass');
    const rules: CompiledRule[] = [{
      id: 'rule-1',
      clauseId: 'clause-1',
      controlId: 'ctrl-1',
      ruleType: 'threshold',
      expression: { type: 'threshold', field: 'amount', operator: 'lte', value: 10000 },
      description: 'Amount must be <= 10000',
      compiledAt: new Date().toISOString(),
    }];

    const repo: VersionedRuleSetRepository = {
      async createRuleSet() { return ruleSet; },
      async activateRuleSet() { return ruleSet; },
      async getActiveRuleSet() { return ruleSet; },
      async getRuleSetById() { return ruleSet; },
      getRulesForSet() { return rules; },
      async listRuleSets() { return [ruleSet]; },
      computeRuleSetHash() { return 'hash'; },
      verifyRuleSetHash() { return true; },
    };

    const clause = makeClause('clause-1', 'Transactions must not exceed $10,000');
    const flow = createEnforcementFlow({
      enforcer: createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: createCompiledRuleEvaluator() }),
      clauseEvidenceRecorder: createClauseEvidenceRecorder(),
      clauseRepository: makeMockClauseRepo([clause]),
      provenanceMetadata: {
        compilerVersion: '1.0.0',
        authoringSchemaVersion: '1.0.0',
        policyFileHash: 'policy-hash',
        linterStatus: { errorCount: 0, warningCount: 1, lintedAt: '2026-05-06T00:00:00.000Z' },
        sourceDocumentId: 'doc-1',
      },
    });

    const evidenceRecorder = new EvidenceRecorder(TENANT, CORR, new NoOpEventService());
    const result = await flow.execute(TENANT, { amount: 5000 }, evidenceRecorder);

    expect(result.outcome).toBe('passed');
    expect(result.enforcementResult).not.toBeNull();
    expect(result.enforcementResult!.passed).toBe(true);
    expect(result.enforcementResult!.evidence[0].clauseText).toBe('Transactions must not exceed $10,000');

    // Evidence chain should include clause_enforcement_evaluated
    const chain = evidenceRecorder.getResult();
    const enfRecord = chain.records.find((r) => r.operationType === 'clause_enforcement_evaluated');
    expect(enfRecord).toBeDefined();
    expect(enfRecord!.payload.compilerVersion).toBe('1.0.0');
    expect(enfRecord!.payload.policyFileHash).toBe('policy-hash');
    expect(enfRecord!.payload.ruleSetHash).toBe('hash');
    expect(enfRecord!.payload.sourceDocumentId).toBe('doc-1');
  });

  it('returns blocked when a rule fails with full provenance', async () => {
    const ruleSet = makeRuleSet('rs-block');
    const rules: CompiledRule[] = [{
      id: 'rule-block',
      clauseId: 'clause-limit',
      controlId: 'ctrl-limit',
      ruleType: 'amount_limit',
      expression: { type: 'amount_limit', field: 'transferAmount', maxAmount: 5000 },
      description: 'Transfer cannot exceed 5000',
      compiledAt: new Date().toISOString(),
    }];

    const repo: VersionedRuleSetRepository = {
      async createRuleSet() { return ruleSet; },
      async activateRuleSet() { return ruleSet; },
      async getActiveRuleSet() { return ruleSet; },
      async getRuleSetById() { return ruleSet; },
      getRulesForSet() { return rules; },
      async listRuleSets() { return [ruleSet]; },
      computeRuleSetHash() { return 'hash'; },
      verifyRuleSetHash() { return true; },
    };

    const clause = makeClause('clause-limit', 'No transfer shall exceed $5,000 without approval');
    const flow = createEnforcementFlow({
      enforcer: createDeterministicEnforcer({ ruleSetRepository: repo, ruleEvaluator: createCompiledRuleEvaluator() }),
      clauseEvidenceRecorder: createClauseEvidenceRecorder(),
      clauseRepository: makeMockClauseRepo([clause]),
    });

    const evidenceRecorder = new EvidenceRecorder(TENANT, CORR, new NoOpEventService());
    const result = await flow.execute(TENANT, { transferAmount: 7500 }, evidenceRecorder);

    expect(result.outcome).toBe('blocked');
    expect(result.enforcementResult!.passed).toBe(false);
    expect(result.enforcementResult!.blockedBy[0].id).toBe('rule-block');
    expect(result.enforcementResult!.evidence[0].clauseText).toBe('No transfer shall exceed $5,000 without approval');
    expect(result.explanation).toContain('Transfer cannot exceed 5000');
  });
});
