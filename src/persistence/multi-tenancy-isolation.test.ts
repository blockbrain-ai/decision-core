/**
 * Multi-Tenancy & Isolation Tests (DC Run 5.2)
 *
 * Comprehensive cross-tenant isolation tests for all 7 repository interfaces.
 * Tests run against both in-memory and SQLite implementations.
 * Verifies D2 standard: tenantId as first parameter, zero cross-tenant leakage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { TenantId } from '../contracts/common.contracts.js';
import { DEFAULT_TENANT_ID } from '../contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../contracts/policy.contracts.js';
import type { DecisionRecord } from '../contracts/decision.contracts.js';
import type { ApprovalCreateInput } from '../contracts/approval.contracts.js';
import type { DomainEvent } from './interfaces/event.repository.js';
import type { PolicyClauseCreateInput, PolicyGraphEdgeCreateInput, CompiledRuleSetCreateInput } from '../contracts/clause.contracts.js';
import { generateUuidV7 } from '../utils/uuid-v7.js';

import { InMemoryPolicyRuleRepository } from './memory/in-memory-policy-rule.repository.js';
import { InMemoryDecisionLogRepository } from './memory/in-memory-decision-log.repository.js';
import { InMemoryApprovalRepository } from './memory/in-memory-approval.repository.js';
import { InMemoryEventRepository } from './memory/in-memory-event.repository.js';
import { InMemoryClauseRepository } from './memory/in-memory-clause.repository.js';
import { InMemoryGraphEdgeRepository } from './memory/in-memory-graph-edge.repository.js';
import { InMemoryCompiledRuleSetRepository } from './memory/in-memory-compiled-rule-set.repository.js';

import { SqlitePolicyRuleRepository } from './sqlite/sqlite-policy-rule.repository.js';
import { SqliteDecisionLogRepository } from './sqlite/sqlite-decision-log.repository.js';
import { SqliteApprovalRepository } from './sqlite/sqlite-approval.repository.js';
import { SqliteEventRepository } from './sqlite/sqlite-event.repository.js';
import { SqliteClauseRepository } from './sqlite/sqlite-clause.repository.js';
import { SqliteGraphEdgeRepository } from './sqlite/sqlite-graph-edge.repository.js';
import { SqliteCompiledRuleSetRepository } from './sqlite/sqlite-compiled-rule-set.repository.js';
import { runMigrations } from './sqlite/migrations.js';

// ===========================================================================
// Tenant Constants
// ===========================================================================

const TENANT_A = 'tenant-alpha' as TenantId;
const TENANT_B = 'tenant-beta' as TenantId;

// ===========================================================================
// Fixture Factories
// ===========================================================================

function makePolicyRuleInput(overrides?: Partial<PolicyRuleCreateInput>): PolicyRuleCreateInput {
  return {
    name: 'isolation-rule',
    description: 'Rule for isolation testing',
    actionTypePattern: 'tool.*',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'safety',
    priority: 10,
    requireApproval: false,
    enabled: true,
    ...overrides,
  };
}

function makeDecisionRecord(tenantId: TenantId, overrides?: Partial<DecisionRecord>): DecisionRecord {
  const now = new Date().toISOString();
  return {
    id: generateUuidV7(),
    surface: 'sdk',
    toolName: 'test-tool',
    status: 'generated',
    confidence: 0.95,
    latency: 42,
    input: { key: 'value' },
    output: { result: 'ok' },
    correlationId: generateUuidV7(),
    tenantId,
    auditHash: 'hash-' + generateUuidV7(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeApprovalInput(overrides?: Partial<ApprovalCreateInput>): ApprovalCreateInput {
  return {
    actionType: 'file.delete',
    riskClass: 'B',
    status: 'pending',
    priority: 'medium',
    requestedBy: 'agent-1',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    constraintDrift: false,
    policyRuleId: 'rule-1',
    actionPayload: { path: '/tmp/file.txt' },
    constraintSnapshot: [],
    currentConstraints: [],
    correlationId: generateUuidV7(),
    ...overrides,
  };
}

function makeEventInput(tenantId: TenantId, overrides?: Partial<DomainEvent>): DomainEvent {
  return {
    id: generateUuidV7(),
    type: 'decision.created',
    source: 'policy-engine',
    payload: { decision: 'allow' },
    timestamp: new Date().toISOString(),
    correlationId: generateUuidV7(),
    tenantId,
    ...overrides,
  };
}

function makeClauseInput(overrides?: Partial<PolicyClauseCreateInput>): PolicyClauseCreateInput {
  return {
    clauseKey: 'ISO-' + generateUuidV7().slice(0, 8),
    text: 'All transactions above $10,000 require dual authorization.',
    clauseType: 'threshold',
    sectionId: 'sec-1',
    sourceDocumentId: 'doc-1',
    status: 'draft',
    effectiveDate: null,
    expiryDate: null,
    correlationId: generateUuidV7(),
    ...overrides,
  };
}

function makeGraphEdgeInput(overrides?: Partial<PolicyGraphEdgeCreateInput>): PolicyGraphEdgeCreateInput {
  return {
    sourceId: 'clause-' + generateUuidV7().slice(0, 8),
    targetId: 'clause-' + generateUuidV7().slice(0, 8),
    edgeType: 'depends_on',
    metadata: { reason: 'prerequisite' },
    correlationId: generateUuidV7(),
    ...overrides,
  };
}

function makeCompiledRuleSetInput(overrides?: Partial<CompiledRuleSetCreateInput>): CompiledRuleSetCreateInput {
  return {
    name: 'RuleSet-' + generateUuidV7().slice(0, 8),
    version: 1,
    status: 'active',
    clauseIds: ['clause-1', 'clause-2'],
    compiledAt: '2026-01-01T00:00:00.000Z',
    activatedAt: '2026-01-01T00:00:00.000Z',
    correlationId: generateUuidV7(),
    ...overrides,
  };
}

// ===========================================================================
// Test Suite Factory — runs the same isolation tests against any implementation
// ===========================================================================

function runPolicyRuleIsolationTests(
  getRepo: () => { create: InstanceType<typeof InMemoryPolicyRuleRepository>['create']; findById: InstanceType<typeof InMemoryPolicyRuleRepository>['findById']; findAll: InstanceType<typeof InMemoryPolicyRuleRepository>['findAll']; findByActionType: InstanceType<typeof InMemoryPolicyRuleRepository>['findByActionType']; count: InstanceType<typeof InMemoryPolicyRuleRepository>['count']; delete: InstanceType<typeof InMemoryPolicyRuleRepository>['delete'] },
) {
  describe('tenant isolation — PolicyRuleRepository', () => {
    it('findById with wrong tenantId returns null', async () => {
      const repo = getRepo();
      const created = await repo.create(TENANT_A, makePolicyRuleInput());
      const fromB = await repo.findById(TENANT_B, created.id);
      expect(fromB).toBeNull();
    });

    it('findAll for tenant B does not include tenant A records', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makePolicyRuleInput({ name: 'rule-a1' }));
      await repo.create(TENANT_A, makePolicyRuleInput({ name: 'rule-a2' }));
      await repo.create(TENANT_B, makePolicyRuleInput({ name: 'rule-b1' }));

      const resultsA = await repo.findAll(TENANT_A);
      const resultsB = await repo.findAll(TENANT_B);

      expect(resultsA).toHaveLength(2);
      expect(resultsB).toHaveLength(1);
      expect(resultsA.every(r => r.tenantId === TENANT_A)).toBe(true);
      expect(resultsB.every(r => r.tenantId === TENANT_B)).toBe(true);
    });

    it('findByActionType is tenant-scoped', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makePolicyRuleInput({ actionTypePattern: 'file.*' }));
      await repo.create(TENANT_B, makePolicyRuleInput({ actionTypePattern: 'file.*' }));

      const resultsA = await repo.findByActionType(TENANT_A, 'file.write');
      expect(resultsA).toHaveLength(1);
      expect(resultsA[0]!.tenantId).toBe(TENANT_A);
    });

    it('count is tenant-scoped', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makePolicyRuleInput());
      await repo.create(TENANT_A, makePolicyRuleInput());
      await repo.create(TENANT_B, makePolicyRuleInput());

      expect(await repo.count(TENANT_A)).toBe(2);
      expect(await repo.count(TENANT_B)).toBe(1);
    });

    it('delete from wrong tenant returns false', async () => {
      const repo = getRepo();
      const created = await repo.create(TENANT_A, makePolicyRuleInput());
      const result = await repo.delete(TENANT_B, created.id);
      expect(result).toBe(false);

      // Original still exists
      const found = await repo.findById(TENANT_A, created.id);
      expect(found).not.toBeNull();
    });
  });
}

function runDecisionLogIsolationTests(
  getRepo: () => { append: InstanceType<typeof InMemoryDecisionLogRepository>['append']; findById: InstanceType<typeof InMemoryDecisionLogRepository>['findById']; findAll: InstanceType<typeof InMemoryDecisionLogRepository>['findAll']; findByCorrelationId: InstanceType<typeof InMemoryDecisionLogRepository>['findByCorrelationId']; count: InstanceType<typeof InMemoryDecisionLogRepository>['count'] },
) {
  describe('tenant isolation — DecisionLogRepository', () => {
    it('findById with wrong tenantId returns null', async () => {
      const repo = getRepo();
      const record = makeDecisionRecord(TENANT_A);
      await repo.append(TENANT_A, record);

      const fromB = await repo.findById(TENANT_B, record.id);
      expect(fromB).toBeNull();
    });

    it('findAll for tenant B does not include tenant A records', async () => {
      const repo = getRepo();
      await repo.append(TENANT_A, makeDecisionRecord(TENANT_A));
      await repo.append(TENANT_A, makeDecisionRecord(TENANT_A));
      await repo.append(TENANT_B, makeDecisionRecord(TENANT_B));

      const resultsA = await repo.findAll(TENANT_A);
      const resultsB = await repo.findAll(TENANT_B);

      expect(resultsA).toHaveLength(2);
      expect(resultsB).toHaveLength(1);
    });

    it('findByCorrelationId is tenant-scoped', async () => {
      const repo = getRepo();
      const sharedCorrId = generateUuidV7();
      await repo.append(TENANT_A, makeDecisionRecord(TENANT_A, { correlationId: sharedCorrId }));
      await repo.append(TENANT_B, makeDecisionRecord(TENANT_B, { correlationId: sharedCorrId }));

      const resultsA = await repo.findByCorrelationId(TENANT_A, sharedCorrId);
      const resultsB = await repo.findByCorrelationId(TENANT_B, sharedCorrId);

      expect(resultsA).toHaveLength(1);
      expect(resultsB).toHaveLength(1);
    });

    it('count is tenant-scoped', async () => {
      const repo = getRepo();
      await repo.append(TENANT_A, makeDecisionRecord(TENANT_A));
      await repo.append(TENANT_B, makeDecisionRecord(TENANT_B));
      await repo.append(TENANT_B, makeDecisionRecord(TENANT_B));

      expect(await repo.count(TENANT_A)).toBe(1);
      expect(await repo.count(TENANT_B)).toBe(2);
    });
  });
}

function runApprovalIsolationTests(
  getRepo: () => { create: InstanceType<typeof InMemoryApprovalRepository>['create']; findById: InstanceType<typeof InMemoryApprovalRepository>['findById']; findAll: InstanceType<typeof InMemoryApprovalRepository>['findAll']; updateStatus: InstanceType<typeof InMemoryApprovalRepository>['updateStatus']; count: InstanceType<typeof InMemoryApprovalRepository>['count'] },
) {
  describe('tenant isolation — ApprovalRepository', () => {
    it('findById with wrong tenantId returns null', async () => {
      const repo = getRepo();
      const created = await repo.create(TENANT_A, makeApprovalInput());

      const fromB = await repo.findById(TENANT_B, created.id);
      expect(fromB).toBeNull();
    });

    it('findAll for tenant B does not include tenant A records', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeApprovalInput());
      await repo.create(TENANT_A, makeApprovalInput());
      await repo.create(TENANT_B, makeApprovalInput());

      const resultsA = await repo.findAll(TENANT_A);
      const resultsB = await repo.findAll(TENANT_B);

      expect(resultsA).toHaveLength(2);
      expect(resultsB).toHaveLength(1);
    });

    it('updateStatus with wrong tenantId returns null', async () => {
      const repo = getRepo();
      const created = await repo.create(TENANT_A, makeApprovalInput());

      const result = await repo.updateStatus(TENANT_B, created.id, 'approved');
      expect(result).toBeNull();

      // Original unchanged
      const found = await repo.findById(TENANT_A, created.id);
      expect(found!.status).toBe('pending');
    });

    it('count is tenant-scoped', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeApprovalInput());
      await repo.create(TENANT_B, makeApprovalInput());
      await repo.create(TENANT_B, makeApprovalInput());

      expect(await repo.count(TENANT_A)).toBe(1);
      expect(await repo.count(TENANT_B)).toBe(2);
    });
  });
}

function runEventIsolationTests(
  getRepo: () => { append: InstanceType<typeof InMemoryEventRepository>['append']; findById: InstanceType<typeof InMemoryEventRepository>['findById']; findAll: InstanceType<typeof InMemoryEventRepository>['findAll']; findByCorrelationId: InstanceType<typeof InMemoryEventRepository>['findByCorrelationId']; count: InstanceType<typeof InMemoryEventRepository>['count'] },
) {
  describe('tenant isolation — EventRepository', () => {
    it('findById with wrong tenantId returns null', async () => {
      const repo = getRepo();
      const event = makeEventInput(TENANT_A);
      await repo.append(TENANT_A, event);

      const fromB = await repo.findById(TENANT_B, event.id);
      expect(fromB).toBeNull();
    });

    it('findAll for tenant B does not include tenant A records', async () => {
      const repo = getRepo();
      await repo.append(TENANT_A, makeEventInput(TENANT_A));
      await repo.append(TENANT_A, makeEventInput(TENANT_A));
      await repo.append(TENANT_B, makeEventInput(TENANT_B));

      const resultsA = await repo.findAll(TENANT_A);
      const resultsB = await repo.findAll(TENANT_B);

      expect(resultsA).toHaveLength(2);
      expect(resultsB).toHaveLength(1);
    });

    it('findByCorrelationId is tenant-scoped', async () => {
      const repo = getRepo();
      const sharedCorrId = generateUuidV7();
      await repo.append(TENANT_A, makeEventInput(TENANT_A, { correlationId: sharedCorrId }));
      await repo.append(TENANT_B, makeEventInput(TENANT_B, { correlationId: sharedCorrId }));

      const resultsA = await repo.findByCorrelationId(TENANT_A, sharedCorrId);
      const resultsB = await repo.findByCorrelationId(TENANT_B, sharedCorrId);

      expect(resultsA).toHaveLength(1);
      expect(resultsB).toHaveLength(1);
    });

    it('count is tenant-scoped', async () => {
      const repo = getRepo();
      await repo.append(TENANT_A, makeEventInput(TENANT_A));
      await repo.append(TENANT_B, makeEventInput(TENANT_B));
      await repo.append(TENANT_B, makeEventInput(TENANT_B));

      expect(await repo.count(TENANT_A)).toBe(1);
      expect(await repo.count(TENANT_B)).toBe(2);
    });
  });
}

function runClauseIsolationTests(
  getRepo: () => { create: InstanceType<typeof InMemoryClauseRepository>['create']; findById: InstanceType<typeof InMemoryClauseRepository>['findById']; findByTenant: InstanceType<typeof InMemoryClauseRepository>['findByTenant']; findBySourceDocument: InstanceType<typeof InMemoryClauseRepository>['findBySourceDocument']; findByStatus: InstanceType<typeof InMemoryClauseRepository>['findByStatus']; update: InstanceType<typeof InMemoryClauseRepository>['update'] },
) {
  describe('tenant isolation — ClauseRepository', () => {
    it('findById with wrong tenantId returns null', async () => {
      const repo = getRepo();
      const created = await repo.create(TENANT_A, makeClauseInput());

      const fromB = await repo.findById(TENANT_B, created.id);
      expect(fromB).toBeNull();
    });

    it('findByTenant returns only that tenant records', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeClauseInput());
      await repo.create(TENANT_A, makeClauseInput({ clauseKey: 'ISO-002' }));
      await repo.create(TENANT_B, makeClauseInput({ clauseKey: 'ISO-003' }));

      const resultsA = await repo.findByTenant(TENANT_A);
      const resultsB = await repo.findByTenant(TENANT_B);

      expect(resultsA).toHaveLength(2);
      expect(resultsB).toHaveLength(1);
    });

    it('findBySourceDocument is tenant-scoped', async () => {
      const repo = getRepo();
      const sharedDocId = 'shared-doc';
      await repo.create(TENANT_A, makeClauseInput({ sourceDocumentId: sharedDocId }));
      await repo.create(TENANT_B, makeClauseInput({ sourceDocumentId: sharedDocId }));

      const resultsA = await repo.findBySourceDocument(TENANT_A, sharedDocId);
      const resultsB = await repo.findBySourceDocument(TENANT_B, sharedDocId);

      expect(resultsA).toHaveLength(1);
      expect(resultsB).toHaveLength(1);
    });

    it('findByStatus is tenant-scoped', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeClauseInput({ status: 'draft' }));
      await repo.create(TENANT_B, makeClauseInput({ status: 'draft' }));

      const resultsA = await repo.findByStatus(TENANT_A, 'draft');
      const resultsB = await repo.findByStatus(TENANT_B, 'draft');

      expect(resultsA).toHaveLength(1);
      expect(resultsB).toHaveLength(1);
    });

    it('update with wrong tenantId returns null', async () => {
      const repo = getRepo();
      const created = await repo.create(TENANT_A, makeClauseInput());

      const result = await repo.update(TENANT_B, created.id, { text: 'modified' });
      expect(result).toBeNull();

      // Original unchanged
      const found = await repo.findById(TENANT_A, created.id);
      expect(found!.text).toBe('All transactions above $10,000 require dual authorization.');
    });
  });
}

function runGraphEdgeIsolationTests(
  getRepo: () => { create: InstanceType<typeof InMemoryGraphEdgeRepository>['create']; delete: InstanceType<typeof InMemoryGraphEdgeRepository>['delete']; findBySource: InstanceType<typeof InMemoryGraphEdgeRepository>['findBySource']; findByTarget: InstanceType<typeof InMemoryGraphEdgeRepository>['findByTarget']; findByEdgeType: InstanceType<typeof InMemoryGraphEdgeRepository>['findByEdgeType']; findByTenant: InstanceType<typeof InMemoryGraphEdgeRepository>['findByTenant'] },
) {
  describe('tenant isolation — GraphEdgeRepository', () => {
    it('findByTenant returns only that tenant records', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeGraphEdgeInput());
      await repo.create(TENANT_A, makeGraphEdgeInput());
      await repo.create(TENANT_B, makeGraphEdgeInput());

      const resultsA = await repo.findByTenant(TENANT_A);
      const resultsB = await repo.findByTenant(TENANT_B);

      expect(resultsA).toHaveLength(2);
      expect(resultsB).toHaveLength(1);
    });

    it('findBySource is tenant-scoped', async () => {
      const repo = getRepo();
      const sharedSource = 'shared-source';
      await repo.create(TENANT_A, makeGraphEdgeInput({ sourceId: sharedSource }));
      await repo.create(TENANT_B, makeGraphEdgeInput({ sourceId: sharedSource }));

      const resultsA = await repo.findBySource(TENANT_A, sharedSource);
      const resultsB = await repo.findBySource(TENANT_B, sharedSource);

      expect(resultsA).toHaveLength(1);
      expect(resultsB).toHaveLength(1);
    });

    it('findByTarget is tenant-scoped', async () => {
      const repo = getRepo();
      const sharedTarget = 'shared-target';
      await repo.create(TENANT_A, makeGraphEdgeInput({ targetId: sharedTarget }));
      await repo.create(TENANT_B, makeGraphEdgeInput({ targetId: sharedTarget }));

      const resultsA = await repo.findByTarget(TENANT_A, sharedTarget);
      const resultsB = await repo.findByTarget(TENANT_B, sharedTarget);

      expect(resultsA).toHaveLength(1);
      expect(resultsB).toHaveLength(1);
    });

    it('findByEdgeType is tenant-scoped', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeGraphEdgeInput({ edgeType: 'conflicts_with' }));
      await repo.create(TENANT_B, makeGraphEdgeInput({ edgeType: 'conflicts_with' }));

      const resultsA = await repo.findByEdgeType(TENANT_A, 'conflicts_with');
      const resultsB = await repo.findByEdgeType(TENANT_B, 'conflicts_with');

      expect(resultsA).toHaveLength(1);
      expect(resultsB).toHaveLength(1);
    });

    it('delete from wrong tenant returns false', async () => {
      const repo = getRepo();
      const created = await repo.create(TENANT_A, makeGraphEdgeInput());

      const result = await repo.delete(TENANT_B, created.id);
      expect(result).toBe(false);

      // Original still exists
      const found = await repo.findByTenant(TENANT_A);
      expect(found).toHaveLength(1);
    });
  });
}

function runCompiledRuleSetIsolationTests(
  getRepo: () => { create: InstanceType<typeof InMemoryCompiledRuleSetRepository>['create']; findById: InstanceType<typeof InMemoryCompiledRuleSetRepository>['findById']; findActive: InstanceType<typeof InMemoryCompiledRuleSetRepository>['findActive']; findByTenant: InstanceType<typeof InMemoryCompiledRuleSetRepository>['findByTenant'] },
) {
  describe('tenant isolation — CompiledRuleSetRepository', () => {
    it('findById with wrong tenantId returns null', async () => {
      const repo = getRepo();
      const created = await repo.create(TENANT_A, makeCompiledRuleSetInput());

      const fromB = await repo.findById(TENANT_B, created.id);
      expect(fromB).toBeNull();
    });

    it('findByTenant returns only that tenant records', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeCompiledRuleSetInput());
      await repo.create(TENANT_A, makeCompiledRuleSetInput({ name: 'Set-2', version: 2 }));
      await repo.create(TENANT_B, makeCompiledRuleSetInput({ name: 'Set-B' }));

      const resultsA = await repo.findByTenant(TENANT_A);
      const resultsB = await repo.findByTenant(TENANT_B);

      expect(resultsA).toHaveLength(2);
      expect(resultsB).toHaveLength(1);
    });

    it('findActive is tenant-scoped', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeCompiledRuleSetInput({ status: 'active' }));
      await repo.create(TENANT_B, makeCompiledRuleSetInput({ status: 'active', name: 'B-active' }));

      const activeA = await repo.findActive(TENANT_A);
      const activeB = await repo.findActive(TENANT_B);

      expect(activeA).not.toBeNull();
      expect(activeB).not.toBeNull();
      expect(activeA!.tenantId).toBe(TENANT_A);
      expect(activeB!.tenantId).toBe(TENANT_B);
    });

    it('findActive returns null when tenant has no active set', async () => {
      const repo = getRepo();
      await repo.create(TENANT_A, makeCompiledRuleSetInput({ status: 'active' }));

      const activeB = await repo.findActive(TENANT_B);
      expect(activeB).toBeNull();
    });
  });
}

// ===========================================================================
// _default Sentinel — Single-Tenant Mode Tests
// ===========================================================================

function runDefaultSentinelTests(
  getRepos: () => {
    policyRule: Pick<InMemoryPolicyRuleRepository, 'create' | 'findById' | 'findAll'>;
    decisionLog: Pick<InMemoryDecisionLogRepository, 'append' | 'findById'>;
    approval: Pick<InMemoryApprovalRepository, 'create' | 'findById'>;
    event: Pick<InMemoryEventRepository, 'append' | 'findById'>;
    clause: Pick<InMemoryClauseRepository, 'create' | 'findById'>;
    graphEdge: Pick<InMemoryGraphEdgeRepository, 'create' | 'findByTenant'>;
    compiledRuleSet: Pick<InMemoryCompiledRuleSetRepository, 'create' | 'findById'>;
  },
) {
  describe('_default sentinel — single-tenant mode', () => {
    it('PolicyRuleRepository works with _default tenantId', async () => {
      const { policyRule } = getRepos();
      const created = await policyRule.create(DEFAULT_TENANT_ID, makePolicyRuleInput());
      expect(created.tenantId).toBe(DEFAULT_TENANT_ID);

      const found = await policyRule.findById(DEFAULT_TENANT_ID, created.id);
      expect(found).toEqual(created);

      const all = await policyRule.findAll(DEFAULT_TENANT_ID);
      expect(all).toHaveLength(1);
    });

    it('DecisionLogRepository works with _default tenantId', async () => {
      const { decisionLog } = getRepos();
      const record = makeDecisionRecord(DEFAULT_TENANT_ID);
      await decisionLog.append(DEFAULT_TENANT_ID, record);

      const found = await decisionLog.findById(DEFAULT_TENANT_ID, record.id);
      expect(found).toEqual(record);
    });

    it('ApprovalRepository works with _default tenantId', async () => {
      const { approval } = getRepos();
      const created = await approval.create(DEFAULT_TENANT_ID, makeApprovalInput());
      expect(created.tenantId).toBe(DEFAULT_TENANT_ID);

      const found = await approval.findById(DEFAULT_TENANT_ID, created.id);
      expect(found).not.toBeNull();
    });

    it('EventRepository works with _default tenantId', async () => {
      const { event } = getRepos();
      const evt = makeEventInput(DEFAULT_TENANT_ID);
      await event.append(DEFAULT_TENANT_ID, evt);

      const found = await event.findById(DEFAULT_TENANT_ID, evt.id);
      expect(found).toEqual(evt);
    });

    it('ClauseRepository works with _default tenantId', async () => {
      const { clause } = getRepos();
      const created = await clause.create(DEFAULT_TENANT_ID, makeClauseInput());
      expect(created.tenantId).toBe(DEFAULT_TENANT_ID);

      const found = await clause.findById(DEFAULT_TENANT_ID, created.id);
      expect(found).not.toBeNull();
    });

    it('GraphEdgeRepository works with _default tenantId', async () => {
      const { graphEdge } = getRepos();
      const created = await graphEdge.create(DEFAULT_TENANT_ID, makeGraphEdgeInput());
      expect(created.tenantId).toBe(DEFAULT_TENANT_ID);

      const all = await graphEdge.findByTenant(DEFAULT_TENANT_ID);
      expect(all).toHaveLength(1);
    });

    it('CompiledRuleSetRepository works with _default tenantId', async () => {
      const { compiledRuleSet } = getRepos();
      const created = await compiledRuleSet.create(DEFAULT_TENANT_ID, makeCompiledRuleSetInput());
      expect(created.tenantId).toBe(DEFAULT_TENANT_ID);

      const found = await compiledRuleSet.findById(DEFAULT_TENANT_ID, created.id);
      expect(found).toEqual(created);
    });

    it('_default tenant data is isolated from named tenants', async () => {
      const { policyRule } = getRepos();
      await policyRule.create(DEFAULT_TENANT_ID, makePolicyRuleInput({ name: 'default-rule' }));
      await policyRule.create(TENANT_A, makePolicyRuleInput({ name: 'tenant-a-rule' }));

      const defaultResults = await policyRule.findAll(DEFAULT_TENANT_ID);
      const tenantAResults = await policyRule.findAll(TENANT_A);

      expect(defaultResults).toHaveLength(1);
      expect(defaultResults[0]!.name).toBe('default-rule');
      expect(tenantAResults).toHaveLength(1);
      expect(tenantAResults[0]!.name).toBe('tenant-a-rule');
    });
  });
}

// ===========================================================================
// In-Memory Implementation Tests
// ===========================================================================

describe('Multi-Tenancy Isolation — In-Memory', () => {
  let policyRule: InMemoryPolicyRuleRepository;
  let decisionLog: InMemoryDecisionLogRepository;
  let approval: InMemoryApprovalRepository;
  let event: InMemoryEventRepository;
  let clause: InMemoryClauseRepository;
  let graphEdge: InMemoryGraphEdgeRepository;
  let compiledRuleSet: InMemoryCompiledRuleSetRepository;

  beforeEach(() => {
    policyRule = new InMemoryPolicyRuleRepository();
    decisionLog = new InMemoryDecisionLogRepository();
    approval = new InMemoryApprovalRepository();
    event = new InMemoryEventRepository();
    clause = new InMemoryClauseRepository();
    graphEdge = new InMemoryGraphEdgeRepository();
    compiledRuleSet = new InMemoryCompiledRuleSetRepository();
  });

  runPolicyRuleIsolationTests(() => policyRule);
  runDecisionLogIsolationTests(() => decisionLog);
  runApprovalIsolationTests(() => approval);
  runEventIsolationTests(() => event);
  runClauseIsolationTests(() => clause);
  runGraphEdgeIsolationTests(() => graphEdge);
  runCompiledRuleSetIsolationTests(() => compiledRuleSet);
  runDefaultSentinelTests(() => ({ policyRule, decisionLog, approval, event, clause, graphEdge, compiledRuleSet }));
});

// ===========================================================================
// SQLite Implementation Tests
// ===========================================================================

describe('Multi-Tenancy Isolation — SQLite', () => {
  let db: Database.Database;
  let policyRule: SqlitePolicyRuleRepository;
  let decisionLog: SqliteDecisionLogRepository;
  let approval: SqliteApprovalRepository;
  let event: SqliteEventRepository;
  let clause: SqliteClauseRepository;
  let graphEdge: SqliteGraphEdgeRepository;
  let compiledRuleSet: SqliteCompiledRuleSetRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    policyRule = new SqlitePolicyRuleRepository(db);
    decisionLog = new SqliteDecisionLogRepository(db);
    approval = new SqliteApprovalRepository(db);
    event = new SqliteEventRepository(db);
    clause = new SqliteClauseRepository(db);
    graphEdge = new SqliteGraphEdgeRepository(db);
    compiledRuleSet = new SqliteCompiledRuleSetRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  runPolicyRuleIsolationTests(() => policyRule);
  runDecisionLogIsolationTests(() => decisionLog);
  runApprovalIsolationTests(() => approval);
  runEventIsolationTests(() => event);
  runClauseIsolationTests(() => clause);
  runGraphEdgeIsolationTests(() => graphEdge);
  runCompiledRuleSetIsolationTests(() => compiledRuleSet);
  runDefaultSentinelTests(() => ({ policyRule, decisionLog, approval, event, clause, graphEdge, compiledRuleSet }));
});
