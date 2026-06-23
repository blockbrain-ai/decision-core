import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceChainService } from './evidence-chain.service.js';
import { HistoricalReplayService } from './historical-replay.service.js';
import type { DecisionRecord, HistoricalReplayDependencies } from './historical-replay.service.js';
import type { CompiledRuleSet } from '../contracts/clause.contracts.js';

describe('HistoricalReplayService', () => {
  let evidenceService: EvidenceChainService;
  let replayService: HistoricalReplayService;
  const tenantId = 'tenant-1';
  const correlationId = 'corr-replay-001';
  const decisionId = 'decision-001';
  const ruleSetId = 'ruleset-001';

  const decision: DecisionRecord = {
    id: decisionId,
    tenantId,
    correlationId,
    timestamp: '2024-06-15T10:00:00.000Z',
    ruleSetId,
  };

  const ruleSet: CompiledRuleSet = {
    id: ruleSetId,
    tenantId,
    name: 'Production Rules v3',
    version: 3,
    status: 'active',
    clauseIds: ['clause-1', 'clause-2', 'clause-3'],
    compiledAt: '2024-06-01T00:00:00.000Z',
    activatedAt: '2024-06-02T00:00:00.000Z',
    correlationId: 'corr-compile-001',
    auditHash: 'hash-ruleset',
    createdAt: '2024-06-01T00:00:00.000Z',
    updatedAt: '2024-06-02T00:00:00.000Z',
  };

  let deps: HistoricalReplayDependencies;

  beforeEach(() => {
    evidenceService = new EvidenceChainService();
    deps = {
      findDecision: (tid, did) => (tid === tenantId && did === decisionId ? decision : null),
      findRuleSet: (tid, rsid) => (tid === tenantId && rsid === ruleSetId ? ruleSet : null),
    };
    replayService = new HistoricalReplayService(evidenceService, deps);
  });

  it('reconstructs the policy version active at decision time', () => {
    // Build evidence chain for the decision
    evidenceService.append({
      correlationId,
      timestamp: '2024-06-15T10:00:00.000Z',
      tenantId,
      operationType: 'input_received',
      payload: { action: 'deploy', target: 'production' },
    });
    evidenceService.append({
      correlationId,
      timestamp: '2024-06-15T10:00:01.000Z',
      tenantId,
      operationType: 'policy_evaluation',
      payload: { ruleSetId, verdict: 'allow' },
    });
    evidenceService.append({
      correlationId,
      timestamp: '2024-06-15T10:00:02.000Z',
      tenantId,
      operationType: 'final_verdict',
      payload: { verdict: 'allow' },
    });

    const result = replayService.replay({ tenantId, correlationId, decisionId });

    expect(result.decisionId).toBe(decisionId);
    expect(result.tenantId).toBe(tenantId);
    expect(result.policySnapshot.ruleSetId).toBe(ruleSetId);
    expect(result.policySnapshot.ruleSetVersion).toBe(3);
    expect(result.policySnapshot.clauseIds).toEqual(['clause-1', 'clause-2', 'clause-3']);
    expect(result.policySnapshot.activatedAt).toBe('2024-06-02T00:00:00.000Z');
    expect(result.policySnapshot.snapshotHash).toBeDefined();
    expect(result.evidenceChain.records).toHaveLength(3);
    expect(result.chainVerification.valid).toBe(true);
  });

  it('reports chain verification failure during replay', () => {
    evidenceService.append({
      correlationId,
      timestamp: '2024-06-15T10:00:00.000Z',
      tenantId,
      operationType: 'input_received',
      payload: { action: 'deploy' },
    });
    evidenceService.append({
      correlationId,
      timestamp: '2024-06-15T10:00:01.000Z',
      tenantId,
      operationType: 'final_verdict',
      payload: { verdict: 'allow' },
    });

    // Tamper with chain
    const chain = evidenceService.getChain(tenantId, correlationId)!;
    (chain.records[0].payload as Record<string, unknown>).action = 'delete-all';

    const result = replayService.replay({ tenantId, correlationId, decisionId });

    expect(result.chainVerification.valid).toBe(false);
    expect(result.chainVerification.brokenAt).toBe(0);
  });

  it('throws when decision not found', () => {
    expect(() =>
      replayService.replay({ tenantId, correlationId, decisionId: 'nonexistent' }),
    ).toThrow('Decision not found');
  });

  it('throws when rule set not found', () => {
    const badDeps: HistoricalReplayDependencies = {
      findDecision: () => ({ ...decision, ruleSetId: 'missing-ruleset' }),
      findRuleSet: () => null,
    };
    const badReplayService = new HistoricalReplayService(evidenceService, badDeps);

    expect(() =>
      badReplayService.replay({ tenantId, correlationId, decisionId }),
    ).toThrow('Rule set not found');
  });

  it('handles replay with empty evidence chain', () => {
    const result = replayService.replay({ tenantId, correlationId, decisionId });

    expect(result.evidenceChain.records).toHaveLength(0);
    expect(result.chainVerification.valid).toBe(true);
    expect(result.policySnapshot.ruleSetVersion).toBe(3);
  });
});
