import { describe, it, expect } from 'vitest';
import { DeterministicDecisionCandidateSchema, ConfidenceTierEnum, RuleFiredSchema } from './deterministic-candidate.js';

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    surfaceId: 'test.surface',
    routeClass: 'deterministic_first_a5_on_uncertain',
    decision: 'approve',
    confidence: 0.9,
    confidenceTier: 'high',
    ruleSetId: 'test.surface:evaluate',
    ruleSetVersion: '0.1.0',
    ruleSetHash: 'abc123',
    rulesFired: [{
      ruleId: 'rule-1',
      description: 'Test rule',
      inputFields: ['field_a'],
      policyRefs: ['policy:test'],
      result: 'allow',
    }],
    missingEvidence: [],
    usedInputFields: ['field_a'],
    ignoredUntrustedFields: [],
    rationale: 'Test',
    safeToExecuteWithoutModel: true,
    ...overrides,
  };
}

describe('DeterministicDecisionCandidateSchema', () => {
  it('parses a valid candidate', () => {
    const result = DeterministicDecisionCandidateSchema.parse(makeCandidate());
    expect(result.surfaceId).toBe('test.surface');
    expect(result.safeToExecuteWithoutModel).toBe(true);
  });

  it('allows null decision', () => {
    const result = DeterministicDecisionCandidateSchema.parse(makeCandidate({ decision: null }));
    expect(result.decision).toBeNull();
  });

  it('rejects confidence out of range', () => {
    expect(() => DeterministicDecisionCandidateSchema.parse(makeCandidate({ confidence: 1.5 }))).toThrow();
    expect(() => DeterministicDecisionCandidateSchema.parse(makeCandidate({ confidence: -0.1 }))).toThrow();
  });

  it('safeToExecuteWithoutModel is false when missing evidence', () => {
    const candidate = DeterministicDecisionCandidateSchema.parse(makeCandidate({
      missingEvidence: ['required_field_1', 'required_field_2'],
      safeToExecuteWithoutModel: false,
    }));
    expect(candidate.safeToExecuteWithoutModel).toBe(false);
    expect(candidate.missingEvidence).toHaveLength(2);
  });

  it('rejects empty surfaceId', () => {
    expect(() => DeterministicDecisionCandidateSchema.parse(makeCandidate({ surfaceId: '' }))).toThrow();
  });
});

describe('ConfidenceTierEnum', () => {
  it('parses all tiers', () => {
    for (const tier of ['hard_rule', 'high', 'medium', 'low', 'no_decision']) {
      expect(ConfidenceTierEnum.parse(tier)).toBe(tier);
    }
  });
});

describe('RuleFiredSchema', () => {
  it('parses valid rule', () => {
    const rule = RuleFiredSchema.parse({
      ruleId: 'r-1',
      description: 'test',
      inputFields: ['a'],
      policyRefs: ['p:1'],
      result: 'block',
    });
    expect(rule.result).toBe('block');
  });

  it('rejects empty ruleId', () => {
    expect(() => RuleFiredSchema.parse({
      ruleId: '',
      description: 'test',
      inputFields: [],
      policyRefs: [],
      result: 'allow',
    })).toThrow();
  });
});
