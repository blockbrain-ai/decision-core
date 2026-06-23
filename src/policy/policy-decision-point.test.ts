import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyDecisionPoint, arbitrate } from './policy-decision-point.js';
import { InMemoryPolicyRuleRepository } from '../persistence/memory/in-memory-policy-rule.repository.js';
import { NoOpEventService } from '../adapters/event-service.js';
import type { TenantId, CorrelationId } from '../contracts/common.contracts.js';
import type { PolicyContext, PolicyRuleCreateInput } from '../contracts/policy.contracts.js';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;
const CORR_ID = 'corr-001' as CorrelationId;

function makeRuleInput(overrides: Partial<PolicyRuleCreateInput> = {}): PolicyRuleCreateInput {
  return {
    name: 'Test Rule',
    description: 'A test rule',
    actionTypePattern: '**',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'safety',
    priority: 10,
    requireApproval: false,
    enabled: true,
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

describe('PolicyDecisionPoint', () => {
  let repo: InMemoryPolicyRuleRepository;
  let pdp: PolicyDecisionPoint;

  beforeEach(() => {
    repo = new InMemoryPolicyRuleRepository();
    pdp = new PolicyDecisionPoint(repo, new NoOpEventService());
  });

  it('allows when no rules exist', async () => {
    const verdict = await pdp.evaluate(TENANT_A, makeContext(), CORR_ID);
    expect(verdict.verdict).toBe('allow');
    expect(verdict.matchedPolicies).toHaveLength(0);
  });

  it('allows when only allow rules match', async () => {
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Allow Rule',
      actionTypePattern: 'finance.*',
      maxAmountUsd: 100000,
    }));
    const verdict = await pdp.evaluate(TENANT_A, makeContext({ financialImpact: 500 }), CORR_ID);
    expect(verdict.verdict).toBe('allow');
  });

  it('denies when a deny rule matches', async () => {
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Deny Rule',
      actionTypePattern: 'finance.*',
      maxAmountUsd: 100,
    }));
    const verdict = await pdp.evaluate(TENANT_A, makeContext({ financialImpact: 5000 }), CORR_ID);
    expect(verdict.verdict).toBe('deny');
  });

  // === CRITICAL: deny-wins ===
  it('deny-wins: if one rule allows and another denies, final verdict is deny', async () => {
    // Rule 1: allows (high financial limit)
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Generous Allow',
      actionTypePattern: 'finance.*',
      maxAmountUsd: 100000,
      priority: 5,
    }));
    // Rule 2: denies (low confidence threshold)
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Strict Confidence',
      actionTypePattern: 'finance.*',
      minConfidence: 0.95,
      priority: 10,
    }));

    const verdict = await pdp.evaluate(
      TENANT_A,
      makeContext({ financialImpact: 500, confidence: 0.5 }),
      CORR_ID,
    );
    expect(verdict.verdict).toBe('deny');
    expect(verdict.matchedPolicies.length).toBeGreaterThanOrEqual(2);
  });

  // === approve_required beats allow ===
  it('approve_required beats allow: if one allows and another requires approval, verdict is approve_required', async () => {
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Allow Rule',
      actionTypePattern: 'finance.*',
      priority: 5,
    }));
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Approval Rule',
      actionTypePattern: 'finance.*',
      requireApproval: true,
      priority: 10,
    }));

    const verdict = await pdp.evaluate(TENANT_A, makeContext(), CORR_ID);
    expect(verdict.verdict).toBe('approve_required');
  });

  // === deny beats approve_required ===
  it('deny beats approve_required: if one requires approval and another denies, verdict is deny', async () => {
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Approval Rule',
      actionTypePattern: 'finance.*',
      requireApproval: true,
      priority: 5,
    }));
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Deny Rule',
      actionTypePattern: 'finance.*',
      minConfidence: 0.99,
      priority: 10,
    }));

    const verdict = await pdp.evaluate(
      TENANT_A,
      makeContext({ confidence: 0.1 }),
      CORR_ID,
    );
    expect(verdict.verdict).toBe('deny');
  });

  // === Tenant isolation ===
  it('tenant isolation: rules from tenant A do not affect tenant B', async () => {
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Tenant A Deny',
      actionTypePattern: 'finance.*',
      minConfidence: 0.99,
    }));

    // Tenant B should see no rules, therefore allow
    const verdictB = await pdp.evaluate(TENANT_B, makeContext({ confidence: 0.1 }), CORR_ID);
    expect(verdictB.verdict).toBe('allow');

    // Tenant A should see the deny rule
    const verdictA = await pdp.evaluate(TENANT_A, makeContext({ confidence: 0.1 }), CORR_ID);
    expect(verdictA.verdict).toBe('deny');
  });

  it('skips disabled rules', async () => {
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Disabled Deny',
      actionTypePattern: 'finance.*',
      minConfidence: 0.99,
      enabled: false,
    }));

    const verdict = await pdp.evaluate(TENANT_A, makeContext({ confidence: 0.1 }), CORR_ID);
    // The rule is disabled, so even though confidence is low, it should allow
    // Note: findByActionType in the in-memory repo returns all matching (including disabled),
    // but evaluateRule filters disabled rules as applies=false
    expect(verdict.verdict).toBe('allow');
  });

  it('records audit entries for each applicable rule', async () => {
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Rule 1',
      actionTypePattern: 'finance.*',
    }));
    await repo.create(TENANT_A, makeRuleInput({
      name: 'Rule 2',
      actionTypePattern: 'finance.*',
      requireApproval: true,
    }));

    await pdp.evaluate(TENANT_A, makeContext(), CORR_ID);

    const auditEntries = pdp.getAuditService().getEntriesByCorrelation(TENANT_A, CORR_ID);
    expect(auditEntries.length).toBeGreaterThanOrEqual(2);

    for (const entry of auditEntries) {
      expect(entry.correlationId).toBe(CORR_ID);
      expect(entry.tenantId).toBe(TENANT_A);
      expect(entry.timestamp).toBeTruthy();
      expect(entry.auditHash).toBeTruthy();
      expect(entry.auditHash.length).toBe(64); // SHA-256 hex
    }
  });

  it('generates correlationId when not provided', async () => {
    await repo.create(TENANT_A, makeRuleInput({ actionTypePattern: 'finance.*' }));
    const verdict = await pdp.evaluate(TENANT_A, makeContext());
    expect(verdict).toBeDefined();
    expect(verdict.verdict).toBe('allow');
  });
});

describe('arbitrate', () => {
  it('returns allow for empty results', () => {
    expect(arbitrate([])).toBe('allow');
  });

  it('returns deny if any result is deny', () => {
    expect(arbitrate([
      { ruleId: '1', ruleName: 'r1', verdict: 'allow', reason: '' },
      { ruleId: '2', ruleName: 'r2', verdict: 'deny', reason: '' },
      { ruleId: '3', ruleName: 'r3', verdict: 'approve_required', reason: '' },
    ])).toBe('deny');
  });

  it('returns approve_required if no deny but has approve_required', () => {
    expect(arbitrate([
      { ruleId: '1', ruleName: 'r1', verdict: 'allow', reason: '' },
      { ruleId: '2', ruleName: 'r2', verdict: 'approve_required', reason: '' },
    ])).toBe('approve_required');
  });

  it('returns allow if all results are allow', () => {
    expect(arbitrate([
      { ruleId: '1', ruleName: 'r1', verdict: 'allow', reason: '' },
      { ruleId: '2', ruleName: 'r2', verdict: 'allow', reason: '' },
    ])).toBe('allow');
  });
});
