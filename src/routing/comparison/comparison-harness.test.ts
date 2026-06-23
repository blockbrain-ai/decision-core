import { describe, it, expect } from 'vitest';
import { runComparison, runBatchComparison, type ComparisonHarnessInput } from './comparison-harness.js';
import type { DeterministicDecisionCandidate } from '../types/deterministic-candidate.js';

function makeCandidate(overrides: Partial<DeterministicDecisionCandidate> = {}): DeterministicDecisionCandidate {
  return {
    surfaceId: 'test.surface',
    routeClass: 'deterministic_first_a5_on_uncertain',
    decision: 'approve',
    confidence: 0.9,
    confidenceTier: 'high',
    ruleSetId: 'test.surface:evaluate',
    ruleSetVersion: '0.1.0',
    ruleSetHash: 'abc123',
    rulesFired: [],
    missingEvidence: [],
    usedInputFields: ['field_a'],
    ignoredUntrustedFields: [],
    rationale: 'Test',
    safeToExecuteWithoutModel: true,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ComparisonHarnessInput> = {}): ComparisonHarnessInput {
  return {
    candidate: makeCandidate(),
    a5Result: {
      surfaceId: 'test.surface',
      scenarioId: 'scenario-1',
      decision: 'approve',
      path: 'a5',
      modelCallCount: 2,
      unsafe: false,
      missingEvidence: [],
    },
    fixture: {
      surfaceId: 'test.surface',
      scenarioId: 'scenario-1',
      expectedDecision: 'approve',
      acceptableDecisions: ['approve', 'conditional_approve'],
      unsafeDecisions: ['terminate', 'reject'],
    },
    ...overrides,
  };
}

describe('runComparison', () => {
  it('produces correct comparison for matching decisions', () => {
    const result = runComparison(makeInput());
    expect(result.surfaceId).toBe('test.surface');
    expect(result.scenarioId).toBe('scenario-1');
    expect(result.safety.deterministicUnsafe).toBe(false);
    expect(result.safety.a5Unsafe).toBe(false);
    expect(result.match.deterministicMatchesExpected).toBe(true);
    expect(result.match.deterministicMatchesAcceptable).toBe(true);
    expect(result.cost.modelCallsSaved).toBe(2);
    expect(result.evidence.deterministicEvidenceComplete).toBe(true);
    expect(result.notes).toBe('OK');
  });

  it('detects unsafe deterministic decision', () => {
    const result = runComparison(makeInput({
      candidate: makeCandidate({ decision: 'terminate' }),
    }));
    expect(result.safety.deterministicUnsafe).toBe(true);
    expect(result.safety.deterministicInUnsafeList).toBe(true);
    expect(result.recommendedRouteClass).toBe('frontier_or_human_required');
    expect(result.notes).toContain('UNSAFE');
  });

  it('detects unsafe a5 decision', () => {
    const result = runComparison(makeInput({
      a5Result: {
        surfaceId: 'test.surface',
        scenarioId: 'scenario-1',
        decision: 'reject',
        path: 'a5',
        modelCallCount: 1,
        unsafe: true,
        missingEvidence: [],
      },
    }));
    expect(result.safety.a5Unsafe).toBe(true);
  });

  it('detects deterministic decision not in acceptable set', () => {
    const result = runComparison(makeInput({
      candidate: makeCandidate({ decision: 'escalate' }),
    }));
    expect(result.match.deterministicMatchesAcceptable).toBe(false);
    expect(result.notes).toContain('not in acceptable set');
  });

  it('handles null deterministic decision', () => {
    const result = runComparison(makeInput({
      candidate: makeCandidate({ decision: null, safeToExecuteWithoutModel: false }),
    }));
    expect(result.match.deterministicMatchesExpected).toBe(false);
    expect(result.notes).toContain('no decision');
  });

  it('reports missing evidence', () => {
    const result = runComparison(makeInput({
      candidate: makeCandidate({ missingEvidence: ['field_x'] }),
    }));
    expect(result.evidence.deterministicEvidenceComplete).toBe(false);
    expect(result.notes).toContain('Missing evidence');
  });

  it('recommends deterministic_only for hard_rule with acceptable match', () => {
    const result = runComparison(makeInput({
      candidate: makeCandidate({ confidenceTier: 'hard_rule' }),
    }));
    expect(result.recommendedRouteClass).toBe('deterministic_only');
  });

  it('recommends deterministic_first for high confidence with acceptable match', () => {
    const result = runComparison(makeInput({
      candidate: makeCandidate({ confidenceTier: 'high' }),
    }));
    expect(result.recommendedRouteClass).toBe('deterministic_first_a5_on_uncertain');
  });

  it('recommends a5_default_with_deterministic_validator when decision does not match acceptable set', () => {
    const result = runComparison(makeInput({
      candidate: makeCandidate({ decision: 'hold', safeToExecuteWithoutModel: true }),
    }));
    expect(result.recommendedRouteClass).toBe('a5_default_with_deterministic_validator');
  });

  it('preserves candidate route class when not safe to execute', () => {
    const result = runComparison(makeInput({
      candidate: makeCandidate({ safeToExecuteWithoutModel: false }),
    }));
    expect(result.recommendedRouteClass).toBe('deterministic_first_a5_on_uncertain');
  });
});

describe('runBatchComparison', () => {
  it('compares multiple inputs', () => {
    const results = runBatchComparison([makeInput(), makeInput()]);
    expect(results).toHaveLength(2);
  });
});
