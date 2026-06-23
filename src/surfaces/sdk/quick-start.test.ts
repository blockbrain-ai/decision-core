/**
 * QuickStart API Tests
 *
 * Tests for quickStart(), fromPolicyPack(), and enhanced explain().
 */

import { describe, it, expect } from 'vitest';
import { quickStart, fromPolicyPack, ConfigValidationError } from './quick-start.js';
import { AVAILABLE_PACKS } from '../../packs/pack-loader.js';
import { ActionApprovalDecision } from '../../decisions/examples/action-approval.decision.js';
import type { BaseDecision, DecisionQualityGateResult } from '../../decisions/base-decision.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { EvaluationSpec } from '../../decisions/evaluation-spec.types.js';

// ===========================================================================
// Test Decision Template
// ===========================================================================

interface TestInput {
  tool: string;
}

interface TestOutput {
  result: string;
}

function makeTestDecision(actionType: string, surfaceId = 'test.surface'): BaseDecision<TestInput, TestOutput> {
  return {
    templateId: 'test-decision',
    version: '1.0.0',
    requiredEntities: [],
    decisionType: 'test',
    entityType: 'test',
    surfaceId,
    actionType,
    evaluationSpec: {
      outcomeMetric: 'test',
      outcomeWindow: '1d',
      successCriteria: 'test passes',
      comparison: 'previous_period',
      successThreshold: 0.9,
      minimumSampleSize: 1,
    } as EvaluationSpec,
    async checkQualityGate(_ctx: { tenantId: TenantId }): Promise<DecisionQualityGateResult> {
      return { status: 'pass', failedEntities: [], message: 'OK' };
    },
    async gatherInputs() {
      return { tool: actionType };
    },
    async evaluate(input: TestInput) {
      return { result: `executed ${input.tool}` };
    },
    buildPrompt(input: TestInput) {
      return `Test: ${input.tool}`;
    },
    parseOutput(raw: unknown) {
      return raw as TestOutput;
    },
  };
}

// ===========================================================================
// quickStart() Tests
// ===========================================================================

describe('quickStart', () => {
  it('returns a working instance with no arguments', async () => {
    const dc = await quickStart();
    expect(dc).toBeDefined();
    expect(dc.tenantId).toBe('default');
    expect(typeof dc.evaluate).toBe('function');
    expect(typeof dc.explain).toBe('function');
  });

  it('deny-unknown: blocks undeclared tools with no args', async () => {
    const dc = await quickStart();
    const decision = makeTestDecision('unknown_tool');
    const result = await dc.evaluate(decision);
    expect(result.verdict).toBe('blocked');
    expect(result.policyVerdict?.verdict).toBe('deny');
  });

  it('allows declared tools when tools are specified', async () => {
    const dc = await quickStart({ tools: ['read_file', 'write_file'] });
    const decision = makeTestDecision('read_file');
    const result = await dc.evaluate(decision);
    expect(result.verdict).toBe('completed');
  });

  it('denies undeclared tools when tools are specified', async () => {
    const dc = await quickStart({ tools: ['read_file', 'write_file'] });
    const decision = makeTestDecision('delete_file');
    const result = await dc.evaluate(decision);
    expect(result.verdict).toBe('blocked');
    expect(result.policyVerdict?.verdict).toBe('deny');
  });

  it('produces team-appropriate defaults with profile: team', async () => {
    const dc = await quickStart({ profile: 'team', tools: ['read_file', 'delete_item'] });

    // Declared tools allowed
    const readResult = await dc.evaluate(makeTestDecision('read_file'));
    expect(readResult.verdict).toBe('completed');

    // delete_* requires approval in team mode
    const deleteResult = await dc.evaluate(makeTestDecision('delete_item'));
    expect(deleteResult.verdict).toBe('approval_required');
  });

  it('produces enterprise-appropriate defaults with profile: enterprise', async () => {
    const dc = await quickStart({ profile: 'enterprise', tools: ['read_file', 'admin_reset'] });

    // Declared tools allowed
    const readResult = await dc.evaluate(makeTestDecision('read_file'));
    expect(readResult.verdict).toBe('completed');

    // admin_* requires approval in enterprise mode
    const adminResult = await dc.evaluate(makeTestDecision('admin_reset'));
    expect(adminResult.verdict).toBe('approval_required');
  });

  it('enterprise mode denies destructive operations', async () => {
    const dc = await quickStart({ profile: 'enterprise', tools: ['delete_record'] });
    const result = await dc.evaluate(makeTestDecision('delete_record'));
    // deny-wins: enterprise-destructive-deny (priority 90, deny) beats allow-delete_record (priority 50, allow)
    expect(result.verdict).toBe('blocked');
  });

  it('accepts agent name option', async () => {
    const dc = await quickStart({ agent: 'My Test Agent' });
    expect(dc).toBeDefined();
    expect(dc.tenantId).toBe('default');
  });
});

// ===========================================================================
// fromPolicyPack() Tests
// ===========================================================================

describe('fromPolicyPack', () => {
  it('loads personal pack and evaluates decisions', async () => {
    const dc = await fromPolicyPack('personal');
    expect(dc).toBeDefined();
    expect(dc.tenantId).toBe('default');

    // Personal pack allows read tools
    const readResult = await dc.evaluate(makeTestDecision('read_file'));
    expect(readResult.verdict).toBe('completed');
  });

  it('personal pack blocks destructive operations', async () => {
    const dc = await fromPolicyPack('personal');
    const result = await dc.evaluate(makeTestDecision('delete_records'));
    // personal pack has block-destructive rule for delete_*
    expect(result.verdict).toBe('blocked');
  });

  it('loads fintech pack with financial controls', async () => {
    const dc = await fromPolicyPack('fintech');
    expect(dc).toBeDefined();

    // Fintech pack blocks destructive operations
    const deleteResult = await dc.evaluate(makeTestDecision('delete_ledger'));
    expect(deleteResult.verdict).toBe('blocked');
  });

  it('loads all five bundled packs without error', async () => {
    for (const packName of AVAILABLE_PACKS) {
      const dc = await fromPolicyPack(packName);
      expect(dc).toBeDefined();
      expect(dc.tenantId).toBe('default');
    }
  });

  it('throws ConfigValidationError for unknown pack', async () => {
    await expect(fromPolicyPack('nonexistent')).rejects.toThrow(ConfigValidationError);
    try {
      await fromPolicyPack('nonexistent');
    } catch (err) {
      const e = err as ConfigValidationError;
      expect(e.suggestions).toBeDefined();
      expect(e.suggestions.length).toBeGreaterThan(0);
      expect(e.suggestions[0]).toContain('Available packs');
    }
  });

  it('accepts tenantId override', async () => {
    const dc = await fromPolicyPack('personal', { tenantId: 'custom-tenant' });
    expect(dc.tenantId).toBe('custom-tenant');
  });
});

// ===========================================================================
// explain() Tests
// ===========================================================================

describe('explain', () => {
  it('produces human-readable explanation for a completed decision', async () => {
    const dc = await quickStart({ tools: ['read_file'] });
    const decision = makeTestDecision('read_file');
    const result = await dc.evaluate(decision);

    const explanation = await dc.explain(result.correlationId);

    expect(explanation.decisionId).toBe(result.correlationId);
    expect(explanation.verdict).toBe('allow');
    expect(explanation.summary).toContain('allowed');
    expect(explanation.timestamp).toBeDefined();
    expect(explanation.rulesEvaluated.length).toBeGreaterThan(0);
    expect(explanation.evidenceSummary).toContain('evidence record');
  });

  it('produces explanation for a denied decision', async () => {
    const dc = await quickStart();
    const decision = makeTestDecision('forbidden_tool');
    const result = await dc.evaluate(decision);

    const explanation = await dc.explain(result.correlationId);

    expect(explanation.verdict).toBe('deny');
    expect(explanation.summary).toContain('denied');
    expect(explanation.rulesEvaluated.length).toBeGreaterThan(0);
    expect(explanation.rulesEvaluated.some(r => r.result === 'deny')).toBe(true);
  });

  it('produces explanation for an approval-required decision', async () => {
    const dc = await quickStart({ profile: 'team', tools: ['delete_item'] });
    const decision = makeTestDecision('delete_item');
    const result = await dc.evaluate(decision);

    const explanation = await dc.explain(result.correlationId);

    expect(explanation.verdict).toBe('approve_required');
    expect(explanation.summary).toContain('Approval required');
  });

  it('throws for unknown decision ID', async () => {
    const dc = await quickStart();
    await expect(dc.explain('nonexistent-id')).rejects.toThrow('No decision found');
  });

  it('includes rule-by-rule breakdown', async () => {
    const dc = await quickStart({ tools: ['search_docs'] });
    const decision = makeTestDecision('search_docs');
    await dc.evaluate(decision);
    const result = await dc.evaluate(decision);

    const explanation = await dc.explain(result.correlationId);

    for (const rule of explanation.rulesEvaluated) {
      expect(rule.ruleId).toBeDefined();
      expect(rule.ruleName).toBeDefined();
      expect(rule.reason).toBeDefined();
      expect(['allow', 'deny', 'approve_required', 'not_applicable']).toContain(rule.result);
    }
  });

  it('includes evidence summary with chain info', async () => {
    const dc = await quickStart({ tools: ['read_file'] });
    const decision = makeTestDecision('read_file');
    const result = await dc.evaluate(decision);

    const explanation = await dc.explain(result.correlationId);

    expect(explanation.evidenceSummary).toContain('evidence record');
    expect(explanation.evidenceSummary).toContain('latency');
  });
});

// ===========================================================================
// Configuration Validation Tests
// ===========================================================================

describe('configuration validation', () => {
  it('throws ConfigValidationError for invalid profile', async () => {
    await expect(
      quickStart({ profile: 'invalid' as 'personal' }),
    ).rejects.toThrow(ConfigValidationError);
  });

  it('provides helpful suggestion for invalid profile', async () => {
    try {
      await quickStart({ profile: 'invalid' as 'personal' });
    } catch (err) {
      const e = err as ConfigValidationError;
      expect(e.suggestions[0]).toContain('Available profiles');
    }
  });

  it('throws ConfigValidationError for sqlite without path', async () => {
    await expect(
      quickStart({ storage: 'sqlite' }),
    ).rejects.toThrow(ConfigValidationError);

    try {
      await quickStart({ storage: 'sqlite' });
    } catch (err) {
      const e = err as ConfigValidationError;
      expect(e.suggestions[0]).toContain('sqlitePath');
    }
  });

  it('throws ConfigValidationError for invalid providerMode', async () => {
    await expect(
      quickStart({ providerMode: 'invalid' as 'host' }),
    ).rejects.toThrow(ConfigValidationError);
  });

  it('includes available options in error suggestions', async () => {
    try {
      await fromPolicyPack('nonexistent');
    } catch (err) {
      const e = err as ConfigValidationError;
      expect(e.message).toContain('nonexistent');
      for (const packName of AVAILABLE_PACKS) {
        expect(e.suggestions[0]).toContain(packName);
      }
    }
  });
});

// ===========================================================================
// defaultVerdict Tests (policy rule entity)
// ===========================================================================

describe('defaultVerdict policy rules', () => {
  it('deny-unknown catch-all denies unmatched tools', async () => {
    const dc = await quickStart({ tools: ['read_file'] });

    // read_file should be allowed (explicit allow rule, priority 50)
    const allowResult = await dc.evaluate(makeTestDecision('read_file'));
    expect(allowResult.verdict).toBe('completed');

    // write_file not declared — should be denied by catch-all
    const denyResult = await dc.evaluate(makeTestDecision('write_file'));
    expect(denyResult.verdict).toBe('blocked');
  });

  it('pack deny rules produce deny verdicts', async () => {
    const dc = await fromPolicyPack('personal');

    // personal pack has block-destructive rule for delete_*, deny action
    const result = await dc.evaluate(makeTestDecision('delete_something'));
    expect(result.verdict).toBe('blocked');
    expect(result.policyVerdict?.verdict).toBe('deny');
  });

  it('pack approve_required rules produce approval verdicts', async () => {
    const dc = await fromPolicyPack('fintech');

    // fintech pack has require-sanctions-check for counterparty_*
    const result = await dc.evaluate(makeTestDecision('counterparty_check'));
    expect(result.verdict).toBe('approval_required');
  });
});

// ===========================================================================
// Integration: ActionApprovalDecision with QuickStart
// ===========================================================================

describe('quickstart with ActionApprovalDecision', () => {
  it('evaluates ActionApprovalDecision through quickstart', async () => {
    // ActionApprovalDecision uses actionType: 'workflow.approve_action'
    const dc = await quickStart({ tools: ['workflow.approve_action'] });
    const decision = new ActionApprovalDecision();

    const result = await dc.evaluate(decision);
    expect(result.verdict).toBe('completed');
    expect(result.output).toBeDefined();
    expect(result.output?.approved).toBe(true);
  });

  it('blocks ActionApprovalDecision when tool not declared', async () => {
    const dc = await quickStart({ tools: ['read_file'] });
    const decision = new ActionApprovalDecision();

    const result = await dc.evaluate(decision);
    expect(result.verdict).toBe('blocked');
  });
});
