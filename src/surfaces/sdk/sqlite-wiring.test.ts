import { describe, it, expect } from 'vitest';
import { quickStart, ConfigValidationError } from './quick-start.js';
import { createDecisionCore } from './create-decision-core.js';
import type { BaseDecision, DecisionQualityGateResult } from '../../decisions/base-decision.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { EvaluationSpec } from '../../decisions/evaluation-spec.types.js';

interface TestInput { tool: string }
interface TestOutput { result: string }

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
    async gatherInputs() { return { tool: actionType }; },
    async evaluate(input: TestInput) { return { result: `executed-${input.tool}` }; },
    buildPrompt(input: TestInput) { return `Test: ${input.tool}`; },
    parseOutput(raw: unknown) { return raw as TestOutput; },
  };
}

describe('quickStart SQLite wiring', () => {
  it('creates working instance with in-memory SQLite', async () => {
    const dc = await quickStart({ storage: 'sqlite', sqlitePath: ':memory:', tools: ['read_file'] });
    const decision = makeTestDecision('read_file');
    const result = await dc.evaluate(decision);
    expect(result.verdict).toBe('completed');
  });

  it('denies unknown actions with SQLite storage', async () => {
    const dc = await quickStart({ storage: 'sqlite', sqlitePath: ':memory:', tools: ['read_file'] });
    const decision = makeTestDecision('unknown_tool');
    const result = await dc.evaluate(decision);
    expect(result.verdict).toBe('blocked');
  });

  it('throws ConfigValidationError when sqlite requested without path', async () => {
    await expect(quickStart({ storage: 'sqlite' })).rejects.toThrow(ConfigValidationError);
  });

  it('quickStart with no options still creates in-memory (regression)', async () => {
    const dc = await quickStart();
    expect(dc.tenantId).toBe('default');
  });
});

describe('createDecisionCore SQLite wiring', () => {
  it('creates working instance with sqlite persistence', async () => {
    const dc = await createDecisionCore({ persistence: 'sqlite', sqlitePath: ':memory:' });
    expect(dc.tenantId).toBe('default');
  });

  it('throws when sqlite persistence omits sqlitePath', async () => {
    await expect(createDecisionCore({ persistence: 'sqlite' })).rejects.toThrow('sqlitePath');
  });

  it('rejects postgres persistence at the schema (not an advertised tier)', async () => {
    // 'postgres' is intentionally not part of the public PersistenceTier (v0.2 roadmap),
    // so it is rejected by schema validation rather than reaching a runtime throw.
    // @ts-expect-error — 'postgres' is not assignable to PersistenceTier.
    await expect(createDecisionCore({ persistence: 'postgres' })).rejects.toThrow(/postgres|memory|sqlite/i);
  });

  it('createDecisionCore with no config still creates in-memory (regression)', async () => {
    const dc = await createDecisionCore();
    expect(dc.tenantId).toBe('default');
  });
});

describe('SQLite defaultVerdict persistence', () => {
  it('persists and hydrates defaultVerdict through SQLite', async () => {
    const { createSqliteConnection } = await import('../../persistence/sqlite/sqlite-connection.js');
    const { SqlitePolicyRuleRepository } = await import('../../persistence/sqlite/sqlite-policy-rule.repository.js');

    const db = createSqliteConnection({ path: ':memory:' });
    const repo = new SqlitePolicyRuleRepository(db);

    const created = await repo.create('test-tenant' as TenantId, {
      name: 'deny-delete',
      description: 'Deny all delete operations',
      actionTypePattern: 'delete_*',
      riskClass: 'A',
      enforcementPoint: 'pre_decision',
      policyType: 'safety',
      priority: 90,
      requireApproval: false,
      defaultVerdict: 'deny',
      enabled: true,
    });

    expect(created.defaultVerdict).toBe('deny');

    const fetched = await repo.findById('test-tenant' as TenantId, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.defaultVerdict).toBe('deny');
  });

  it('hydrates undefined defaultVerdict as undefined', async () => {
    const { createSqliteConnection } = await import('../../persistence/sqlite/sqlite-connection.js');
    const { SqlitePolicyRuleRepository } = await import('../../persistence/sqlite/sqlite-policy-rule.repository.js');

    const db = createSqliteConnection({ path: ':memory:' });
    const repo = new SqlitePolicyRuleRepository(db);

    const created = await repo.create('test-tenant' as TenantId, {
      name: 'allow-read',
      description: 'Allow read operations',
      actionTypePattern: 'read_*',
      riskClass: 'B',
      enforcementPoint: 'pre_decision',
      policyType: 'business',
      priority: 50,
      requireApproval: false,
      enabled: true,
    });

    const fetched = await repo.findById('test-tenant' as TenantId, created.id);
    expect(fetched!.defaultVerdict).toBeUndefined();
  });

  it('updates defaultVerdict through SQLite', async () => {
    const { createSqliteConnection } = await import('../../persistence/sqlite/sqlite-connection.js');
    const { SqlitePolicyRuleRepository } = await import('../../persistence/sqlite/sqlite-policy-rule.repository.js');

    const db = createSqliteConnection({ path: ':memory:' });
    const repo = new SqlitePolicyRuleRepository(db);

    const created = await repo.create('test-tenant' as TenantId, {
      name: 'test-rule',
      description: 'Test',
      actionTypePattern: 'test_*',
      riskClass: 'B',
      enforcementPoint: 'pre_decision',
      policyType: 'business',
      priority: 50,
      requireApproval: false,
      enabled: true,
    });

    const updated = await repo.update('test-tenant' as TenantId, created.id, {
      defaultVerdict: 'deny',
    });
    expect(updated!.defaultVerdict).toBe('deny');

    const fetched = await repo.findById('test-tenant' as TenantId, created.id);
    expect(fetched!.defaultVerdict).toBe('deny');
  });
});
