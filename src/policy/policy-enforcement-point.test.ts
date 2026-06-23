import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEnforcementPoint } from './policy-enforcement-point.js';
import { PolicyDecisionPoint } from './policy-decision-point.js';
import { InMemoryPolicyRuleRepository } from '../persistence/memory/in-memory-policy-rule.repository.js';
import { NoOpEventService } from '../adapters/event-service.js';
import type { EventService } from '../adapters/event-service.js';
import type { DomainEvent } from '../persistence/interfaces/event.repository.js';
import { POLICY_EVENTS } from './policy.events.js';
import type { TenantId } from '../contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../contracts/policy.contracts.js';

const TENANT = 'tenant-pep' as TenantId;

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

describe('PolicyEnforcementPoint', () => {
  let repo: InMemoryPolicyRuleRepository;
  let pep: PolicyEnforcementPoint;

  beforeEach(() => {
    repo = new InMemoryPolicyRuleRepository();
    const eventService = new NoOpEventService();
    const pdp = new PolicyDecisionPoint(repo, eventService);
    pep = new PolicyEnforcementPoint(pdp, eventService);
  });

  it('allows when no rules exist', async () => {
    const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete');
    expect(result.allowed).toBe(true);
    expect(result.verdict).toBe('allow');
  });

  describe('strict mode (autonomy 0-1)', () => {
    it('blocks on deny', async () => {
      await repo.create(TENANT, makeRuleInput({
        name: 'Deny Rule',
        actionTypePattern: 'finance.*',
        minConfidence: 0.99,
      }));

      const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete', {
        autonomyLevel: 0,
        confidence: 0.1,
      });
      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('deny');
      expect(result.autonomyMode).toBe('strict');
    });

    it('blocks on approve_required', async () => {
      await repo.create(TENANT, makeRuleInput({
        name: 'Approval Rule',
        actionTypePattern: 'finance.*',
        requireApproval: true,
      }));

      const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete', {
        autonomyLevel: 1,
      });
      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('approve_required');
      expect(result.autonomyMode).toBe('strict');
    });
  });

  describe('permissive mode (autonomy 2-3)', () => {
    it('blocks on deny', async () => {
      await repo.create(TENANT, makeRuleInput({
        name: 'Deny Rule',
        actionTypePattern: 'finance.*',
        minConfidence: 0.99,
      }));

      const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete', {
        autonomyLevel: 2,
        confidence: 0.1,
      });
      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('deny');
      expect(result.autonomyMode).toBe('permissive');
    });

    it('allows on approve_required (relaxed)', async () => {
      await repo.create(TENANT, makeRuleInput({
        name: 'Approval Rule',
        actionTypePattern: 'finance.*',
        requireApproval: true,
      }));

      const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete', {
        autonomyLevel: 3,
      });
      expect(result.allowed).toBe(true);
      expect(result.verdict).toBe('allow');
      expect(result.autonomyMode).toBe('permissive');
    });
  });

  describe('advisory mode (autonomy 4-5)', () => {
    it('allows even on deny', async () => {
      await repo.create(TENANT, makeRuleInput({
        name: 'Deny Rule',
        actionTypePattern: 'finance.*',
        minConfidence: 0.99,
      }));

      const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete', {
        autonomyLevel: 5,
        confidence: 0.1,
      });
      expect(result.allowed).toBe(true);
      expect(result.verdict).toBe('deny'); // verdict preserved for logging
      expect(result.autonomyMode).toBe('advisory');
    });

    it('allows on approve_required', async () => {
      await repo.create(TENANT, makeRuleInput({
        name: 'Approval Rule',
        actionTypePattern: 'finance.*',
        requireApproval: true,
      }));

      const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete', {
        autonomyLevel: 4,
      });
      expect(result.allowed).toBe(true);
      expect(result.autonomyMode).toBe('advisory');
    });
  });

  it('defaults to strict autonomy when not specified', async () => {
    await repo.create(TENANT, makeRuleInput({
      name: 'Approval Rule',
      actionTypePattern: 'finance.*',
      requireApproval: true,
    }));

    const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete');
    expect(result.allowed).toBe(false);
    expect(result.autonomyMode).toBe('strict');
  });

  it('includes explanation in result', async () => {
    await repo.create(TENANT, makeRuleInput({
      name: 'Allow Rule',
      actionTypePattern: 'finance.*',
    }));

    const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete');
    expect(result.explanation).toBeTruthy();
    expect(typeof result.explanation).toBe('string');
  });

  it('includes correlationId in result', async () => {
    const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete', {
      correlationId: 'my-corr-id',
    });
    expect(result.correlationId).toBe('my-corr-id');
  });

  it('generates correlationId when not provided', async () => {
    const result = await pep.enforce(TENANT, 'pre_decision', 'finance.delete');
    expect(result.correlationId).toBeTruthy();
  });

  describe('enforcement event type', () => {
    function buildWithCapture() {
      const events: DomainEvent[] = [];
      const eventService: EventService = { emit: (e) => { events.push(e); } };
      const r = new InMemoryPolicyRuleRepository();
      const pdp = new PolicyDecisionPoint(r, eventService);
      const point = new PolicyEnforcementPoint(pdp, eventService);
      const pepEvent = () => events.find((e) => e.source === 'policy-enforcement-point');
      return { r, point, pepEvent };
    }

    it('emits POLICY_ENFORCED when the action is allowed', async () => {
      const { point, pepEvent } = buildWithCapture();
      const result = await point.enforce(TENANT, 'pre_decision', 'finance.delete');
      expect(result.allowed).toBe(true);
      expect(pepEvent()?.type).toBe(POLICY_EVENTS.POLICY_ENFORCED);
    });

    it('emits POLICY_BLOCKED (not POLICY_ENFORCED) when the action is blocked', async () => {
      const { r, point, pepEvent } = buildWithCapture();
      await r.create(TENANT, makeRuleInput({
        name: 'Deny Rule',
        actionTypePattern: 'finance.*',
        requireApproval: true,
      }));
      const result = await point.enforce(TENANT, 'pre_decision', 'finance.delete', { autonomyLevel: 0 });
      expect(result.allowed).toBe(false);
      expect(pepEvent()?.type).toBe(POLICY_EVENTS.POLICY_BLOCKED);
      expect(pepEvent()?.type).not.toBe(POLICY_EVENTS.POLICY_ENFORCED);
    });
  });
});
