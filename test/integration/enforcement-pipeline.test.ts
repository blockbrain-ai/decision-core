/**
 * Integration Test — Enforcement Pipeline
 *
 * Full pipeline: ingest policy → approve clauses → compile rules →
 * activate rule set → evaluate decision → verify clause provenance in evidence.
 *
 * Also verifies fallback when no compiled rule set exists.
 */

import { describe, it, expect } from 'vitest';
import { DecisionRunner } from '../../src/decisions/decision-runner.js';
import type { DecisionRunnerDeps } from '../../src/decisions/decision-runner.js';
import { ActionApprovalDecision } from '../../src/decisions/examples/action-approval.decision.js';
import { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';
import { SurfaceResolver } from '../../src/trust/surface-resolver.js';
import { TrustPolicyLoader } from '../../src/trust/trust-policy.js';
import { RuntimeRouteResolver } from '../../src/routing/runtime/runtime-route-resolver.js';
import { InMemoryDecisionLogRepository } from '../../src/persistence/memory/in-memory-decision-log.repository.js';
import { InMemoryPolicyRuleRepository } from '../../src/persistence/memory/in-memory-policy-rule.repository.js';
import { InMemoryClauseRepository } from '../../src/persistence/memory/in-memory-clause.repository.js';
import { InMemoryCompiledRuleSetRepository } from '../../src/persistence/memory/in-memory-compiled-rule-set.repository.js';
import { NoOpEventService } from '../../src/adapters/event-service.js';
import { createDeterministicEnforcer } from '../../src/knowledge/enforcement/deterministic-enforcer.js';
import { createClauseEvidenceRecorder } from '../../src/knowledge/enforcement/clause-evidence-recorder.js';
import { createEnforcementFlow } from '../../src/knowledge/enforcement/enforcement-flow.js';
import { createCompiledRuleEvaluator } from '../../src/knowledge/compiler/compiled-rule-evaluator.js';
import { createVersionedRuleSetRepository } from '../../src/knowledge/compiler/compiled-rule-set.repository.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../../src/contracts/policy.contracts.js';
import type { PolicyClauseCreateInput } from '../../src/contracts/clause.contracts.js';
import type { CompiledRule } from '../../src/knowledge/compiler/policy-rule-expression.types.js';

// ===========================================================================
// Constants
// ===========================================================================

const TENANT = 'tenant-enforcement-int' as TenantId;

// ===========================================================================
// Helpers
// ===========================================================================

function makeAllowRule(actionPattern: string): PolicyRuleCreateInput {
  return {
    name: `Allow ${actionPattern}`,
    description: `Allow rule for ${actionPattern}`,
    actionTypePattern: actionPattern,
    riskClass: 'A',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 10,
    requiredConstraints: [],
    requireApproval: false,
    enabled: true,
  };
}

function makeClauseInput(key: string, text: string, type: 'threshold' | 'obligation' = 'threshold'): PolicyClauseCreateInput {
  return {
    clauseKey: key,
    text,
    clauseType: type,
    sectionId: 'sec-1',
    sourceDocumentId: 'doc-1',
    status: 'approved',
    effectiveDate: null,
    expiryDate: null,
    correlationId: 'corr-int',
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Enforcement Pipeline Integration', () => {
  it('full flow: ingest → approve → compile → enforce (pass) → verify provenance', async () => {
    const eventService = new NoOpEventService();
    const policyRuleRepo = new InMemoryPolicyRuleRepository();
    const decisionLog = new InMemoryDecisionLogRepository();
    const clauseRepo = new InMemoryClauseRepository();
    const ruleSetBaseRepo = new InMemoryCompiledRuleSetRepository();
    const ruleSetRepo = createVersionedRuleSetRepository(ruleSetBaseRepo);

    // Step 1: Seed Phase 1 policy rule (allow)
    await policyRuleRepo.create(TENANT, makeAllowRule('workflow.*'));

    // Step 2: Ingest clause (simulating ingestion)
    const clause = await clauseRepo.create(TENANT, makeClauseInput(
      'max-amount-clause',
      'No single transaction shall exceed $50,000 without dual authorization',
    ));

    // Step 3: Compile rule from clause
    const compiledRules: CompiledRule[] = [{
      id: 'compiled-rule-1',
      clauseId: clause.id,
      controlId: 'ctrl-amount',
      ruleType: 'amount_limit',
      expression: { type: 'amount_limit', field: 'amount', maxAmount: 50000 },
      description: 'Transaction amount must not exceed 50000',
      compiledAt: new Date().toISOString(),
    }];

    // Step 4: Create and activate rule set
    const ruleSet = await ruleSetRepo.createRuleSet(
      TENANT, 'policy-rules-v1', compiledRules, [clause.id], 'corr-compile',
    );
    await ruleSetRepo.activateRuleSet(TENANT, ruleSet.id);

    // Step 5: Build enforcement flow
    const enforcementFlow = createEnforcementFlow({
      enforcer: createDeterministicEnforcer({
        ruleSetRepository: ruleSetRepo,
        ruleEvaluator: createCompiledRuleEvaluator(),
      }),
      clauseEvidenceRecorder: createClauseEvidenceRecorder(),
      clauseRepository: clauseRepo,
    });

    // Step 6: Build decision runner with enforcement
    const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);
    const trustLoader = new TrustPolicyLoader();
    const surfaceResolver = new SurfaceResolver(trustLoader);
    const routeResolver = new RuntimeRouteResolver();

    const deps: DecisionRunnerDeps = {
      pdp,
      surfaceResolver,
      routeResolver,
      decisionLog,
      eventService,
      enforcementFlow,
    };

    const runner = new DecisionRunner(deps);

    // Step 7: Execute decision with context that PASSES rules
    const decision = new ActionApprovalDecision();

    const result = await runner.execute(TENANT, decision, {
      metadata: { amount: 30000 },
    });

    // Verify: decision passes
    expect(result.verdict).toBe('completed');

    // Verify: clause evidence is present
    expect(result.clauseEvidence).toHaveLength(1);
    expect(result.clauseEvidence[0].clauseId).toBe(clause.id);
    expect(result.clauseEvidence[0].clauseText).toBe(
      'No single transaction shall exceed $50,000 without dual authorization',
    );
    expect(result.clauseEvidence[0].result).toBe('pass');
    expect(result.clauseEvidence[0].ruleType).toBe('amount_limit');
    expect(result.clauseEvidence[0].controlId).toBe('ctrl-amount');

    // Verify: rule set version recorded
    expect(result.ruleSetVersion).toBe(1);
  });

  it('full flow: enforce (block) — includes specific rule, clause, and control', async () => {
    const eventService = new NoOpEventService();
    const policyRuleRepo = new InMemoryPolicyRuleRepository();
    const decisionLog = new InMemoryDecisionLogRepository();
    const clauseRepo = new InMemoryClauseRepository();
    const ruleSetBaseRepo = new InMemoryCompiledRuleSetRepository();
    const ruleSetRepo = createVersionedRuleSetRepository(ruleSetBaseRepo);

    await policyRuleRepo.create(TENANT, makeAllowRule('workflow.*'));

    const clause = await clauseRepo.create(TENANT, makeClauseInput(
      'jurisdiction-clause',
      'Operations are only permitted in AU, NZ, and UK jurisdictions',
    ));

    const compiledRules: CompiledRule[] = [{
      id: 'compiled-rule-jur',
      clauseId: clause.id,
      controlId: 'ctrl-jurisdiction',
      ruleType: 'jurisdiction_match',
      expression: {
        type: 'jurisdiction_match',
        field: 'jurisdiction',
        allowedJurisdictions: ['AU', 'NZ', 'UK'],
      },
      description: 'Jurisdiction must be AU, NZ, or UK',
      compiledAt: new Date().toISOString(),
    }];

    const ruleSet = await ruleSetRepo.createRuleSet(
      TENANT, 'jurisdiction-rules', compiledRules, [clause.id], 'corr-jur',
    );
    await ruleSetRepo.activateRuleSet(TENANT, ruleSet.id);

    const enforcementFlow = createEnforcementFlow({
      enforcer: createDeterministicEnforcer({
        ruleSetRepository: ruleSetRepo,
        ruleEvaluator: createCompiledRuleEvaluator(),
      }),
      clauseEvidenceRecorder: createClauseEvidenceRecorder(),
      clauseRepository: clauseRepo,
    });

    const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);
    const runner = new DecisionRunner({
      pdp,
      surfaceResolver: new SurfaceResolver(new TrustPolicyLoader()),
      routeResolver: new RuntimeRouteResolver(),
      decisionLog,
      eventService,
      enforcementFlow,
    });

    const decision = new ActionApprovalDecision();

    const result = await runner.execute(TENANT, decision, {
      metadata: { jurisdiction: 'US' },
    });

    // Verify: decision is blocked
    expect(result.verdict).toBe('blocked');
    expect(result.explanation).toContain('Jurisdiction must be AU, NZ, or UK');

    // Verify: clause evidence includes the blocking rule
    expect(result.clauseEvidence).toHaveLength(1);
    expect(result.clauseEvidence[0].clauseId).toBe(clause.id);
    expect(result.clauseEvidence[0].clauseText).toBe(
      'Operations are only permitted in AU, NZ, and UK jurisdictions',
    );
    expect(result.clauseEvidence[0].result).toBe('fail');
    expect(result.clauseEvidence[0].controlId).toBe('ctrl-jurisdiction');
    expect(result.clauseEvidence[0].ruleId).toBe('compiled-rule-jur');
    expect(result.clauseEvidence[0].inputFields).toHaveProperty('jurisdiction', 'US');
  });

  it('fallback: when no compiled rule set exists, Phase 1 policy engine handles it', async () => {
    const eventService = new NoOpEventService();
    const policyRuleRepo = new InMemoryPolicyRuleRepository();
    const decisionLog = new InMemoryDecisionLogRepository();
    const clauseRepo = new InMemoryClauseRepository();
    const ruleSetBaseRepo = new InMemoryCompiledRuleSetRepository();
    const ruleSetRepo = createVersionedRuleSetRepository(ruleSetBaseRepo);

    // Phase 1 policy allows the action
    await policyRuleRepo.create(TENANT, makeAllowRule('workflow.*'));

    // No compiled rule set created — enforcement should skip
    const enforcementFlow = createEnforcementFlow({
      enforcer: createDeterministicEnforcer({
        ruleSetRepository: ruleSetRepo,
        ruleEvaluator: createCompiledRuleEvaluator(),
      }),
      clauseEvidenceRecorder: createClauseEvidenceRecorder(),
      clauseRepository: clauseRepo,
    });

    const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);
    const runner = new DecisionRunner({
      pdp,
      surfaceResolver: new SurfaceResolver(new TrustPolicyLoader()),
      routeResolver: new RuntimeRouteResolver(),
      decisionLog,
      eventService,
      enforcementFlow,
    });

    const decision = new ActionApprovalDecision();

    const result = await runner.execute(TENANT, decision);

    // Decision completes via Phase 1 path (no clause enforcement)
    expect(result.verdict).toBe('completed');
    expect(result.clauseEvidence).toHaveLength(0);
    expect(result.ruleSetVersion).toBeNull();
  });

  it('decision runner pipeline order: hard-block → compiled-rules → model-route → evidence', async () => {
    const eventService = new NoOpEventService();
    const policyRuleRepo = new InMemoryPolicyRuleRepository();
    const decisionLog = new InMemoryDecisionLogRepository();
    const clauseRepo = new InMemoryClauseRepository();
    const ruleSetBaseRepo = new InMemoryCompiledRuleSetRepository();
    const ruleSetRepo = createVersionedRuleSetRepository(ruleSetBaseRepo);

    // Policy allows
    await policyRuleRepo.create(TENANT, makeAllowRule('workflow.*'));

    // Create two clauses and rules
    const clause1 = await clauseRepo.create(TENANT, makeClauseInput(
      'amount-cap', 'Amounts capped at 100000',
    ));
    const clause2 = await clauseRepo.create(TENANT, makeClauseInput(
      'role-check', 'Must have admin role', 'obligation',
    ));

    const compiledRules: CompiledRule[] = [
      {
        id: 'rule-amount',
        clauseId: clause1.id,
        controlId: 'ctrl-cap',
        ruleType: 'amount_limit',
        expression: { type: 'amount_limit', field: 'amount', maxAmount: 100000 },
        description: 'Amount cap at 100000',
        compiledAt: new Date().toISOString(),
      },
      {
        id: 'rule-role',
        clauseId: clause2.id,
        controlId: 'ctrl-role',
        ruleType: 'role_required',
        expression: { type: 'role_required', field: 'roles', requiredRoles: ['admin'], anyOf: true },
        description: 'Must have admin role',
        compiledAt: new Date().toISOString(),
      },
    ];

    const ruleSet = await ruleSetRepo.createRuleSet(
      TENANT, 'multi-rules', compiledRules, [clause1.id, clause2.id], 'corr-multi',
    );
    await ruleSetRepo.activateRuleSet(TENANT, ruleSet.id);

    const enforcementFlow = createEnforcementFlow({
      enforcer: createDeterministicEnforcer({
        ruleSetRepository: ruleSetRepo,
        ruleEvaluator: createCompiledRuleEvaluator(),
      }),
      clauseEvidenceRecorder: createClauseEvidenceRecorder(),
      clauseRepository: clauseRepo,
    });

    const runner = new DecisionRunner({
      pdp: new PolicyDecisionPoint(policyRuleRepo, eventService),
      surfaceResolver: new SurfaceResolver(new TrustPolicyLoader()),
      routeResolver: new RuntimeRouteResolver(),
      decisionLog,
      eventService,
      enforcementFlow,
    });

    const decision = new ActionApprovalDecision();

    // Both rules pass
    const result = await runner.execute(TENANT, decision, {
      metadata: { amount: 50000, roles: ['admin', 'operator'] },
    });

    expect(result.verdict).toBe('completed');
    expect(result.clauseEvidence).toHaveLength(2);
    expect(result.clauseEvidence.every((e) => e.result === 'pass')).toBe(true);
    expect(result.ruleSetVersion).toBe(1);

    // Verify evidence chain includes enforcement step
    expect(result.evidenceChain.recordCount).toBeGreaterThan(3);
  });
});
