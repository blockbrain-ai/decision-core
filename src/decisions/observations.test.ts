import { describe, it, expect } from 'vitest';
import { aggregateObservations } from './observations.js';
import type { DecisionRecord } from '../contracts/decision.contracts.js';

function rec(overrides: Partial<DecisionRecord> & { output: Record<string, unknown> }): DecisionRecord {
  return {
    id: Math.random().toString(36).slice(2),
    surface: 'api',
    toolName: 'tool',
    status: 'generated',
    confidence: 1,
    latency: 1,
    input: { action: 'x', context: { secret: 'SHOULD_NOT_LEAK' } },
    correlationId: 'corr-' + Math.random().toString(36).slice(2),
    tenantId: 'default',
    auditHash: 'h',
    createdAt: '2026-06-24T10:00:00.000Z',
    updatedAt: '2026-06-24T10:00:00.000Z',
    ...overrides,
  } as DecisionRecord;
}

const observeDeny = (toolName: string, at: string, ruleName = 'cap') =>
  rec({
    toolName,
    createdAt: at,
    output: {
      decision: 'allow',
      observedDecision: 'deny',
      enforcementMode: 'observe',
      matchedPolicies: [{ ruleId: 'r1', ruleName, verdict: 'deny', reason: 'over the cap' }],
      rationale: 'Observe mode — allowed (would be deny under enforce)',
    },
  });

describe('aggregateObservations', () => {
  it('aggregates observe-mode would-be denials by tool + verdict with counts and first/last seen', () => {
    const summary = aggregateObservations([
      observeDeny('deploy.prod', '2026-06-24T10:00:00.000Z'),
      observeDeny('deploy.prod', '2026-06-24T12:00:00.000Z'),
      observeDeny('delete.db', '2026-06-24T11:00:00.000Z'),
    ]);
    expect(summary.totalObservations).toBe(3);
    expect(summary.groups).toHaveLength(2);
    const deploy = summary.groups.find((g) => g.toolName === 'deploy.prod')!;
    expect(deploy.count).toBe(2);
    expect(deploy.observedVerdict).toBe('deny');
    expect(deploy.firstSeen).toBe('2026-06-24T10:00:00.000Z');
    expect(deploy.lastSeen).toBe('2026-06-24T12:00:00.000Z');
    expect(deploy.matchedRules[0].ruleName).toBe('cap');
    expect(summary.nextRecommendedAction).toBe('review_then_enforce');
  });

  it('ignores enforce-mode records and observe-mode allows', () => {
    const summary = aggregateObservations([
      rec({ toolName: 'a', output: { decision: 'deny', enforcementMode: 'enforce', matchedPolicies: [] } }),
      rec({ toolName: 'b', output: { decision: 'allow', observedDecision: 'allow', enforcementMode: 'observe', matchedPolicies: [] } }),
    ]);
    expect(summary.totalObservations).toBe(0);
    expect(summary.groups).toHaveLength(0);
    expect(summary.nextRecommendedAction).toBe('nothing_observed_yet');
  });

  it('REDACTS tool arguments — examples never carry input context/secrets', () => {
    const summary = aggregateObservations([observeDeny('deploy.prod', '2026-06-24T10:00:00.000Z')]);
    const json = JSON.stringify(summary);
    expect(json).not.toContain('SHOULD_NOT_LEAK');
    // Example carries only metadata + rule reason.
    const ex = summary.groups[0].examples[0];
    expect(ex.reason).toBe('over the cap');
    expect(ex).not.toHaveProperty('context');
    expect(ex).not.toHaveProperty('input');
  });
});
