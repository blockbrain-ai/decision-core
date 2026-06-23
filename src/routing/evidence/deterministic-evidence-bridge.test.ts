import { describe, it, expect } from 'vitest';
import {
  bridgeDeterministicToEvidence,
  buildCandidateSummary,
  mapCandidateToConfidenceTier,
  type DeterministicEvidenceBridgeInput,
} from './deterministic-evidence-bridge.js';
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
    ruleSetHash: 'abc123def456',
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
    rationale: 'Test candidate',
    safeToExecuteWithoutModel: true,
    ...overrides,
  };
}

describe('mapCandidateToConfidenceTier', () => {
  it('maps hard_rule to production', () => {
    expect(mapCandidateToConfidenceTier('hard_rule')).toBe('production');
  });

  it('maps high to provider', () => {
    expect(mapCandidateToConfidenceTier('high')).toBe('provider');
  });

  it('maps medium to deployer', () => {
    expect(mapCandidateToConfidenceTier('medium')).toBe('deployer');
  });

  it('maps low to directional', () => {
    expect(mapCandidateToConfidenceTier('low')).toBe('directional');
  });

  it('maps no_decision to directional', () => {
    expect(mapCandidateToConfidenceTier('no_decision')).toBe('directional');
  });
});

describe('buildCandidateSummary', () => {
  it('builds summary with hash', () => {
    const candidate = makeCandidate();
    const summary = buildCandidateSummary(candidate);
    expect(summary.candidateHash).toBeTruthy();
    expect(summary.candidateHash.length).toBe(64); // SHA-256 hex
    expect(summary.routeClass).toBe('deterministic_first_a5_on_uncertain');
    expect(summary.safeToExecuteWithoutModel).toBe(true);
    expect(summary.ruleSetId).toBe('test.surface:evaluate');
  });

  it('produces different hashes for different decisions', () => {
    const summary1 = buildCandidateSummary(makeCandidate({ decision: 'approve' }));
    const summary2 = buildCandidateSummary(makeCandidate({ decision: 'deny' }));
    expect(summary1.candidateHash).not.toBe(summary2.candidateHash);
  });
});

describe('bridgeDeterministicToEvidence', () => {
  it('bridges candidate to evidence record', () => {
    const input: DeterministicEvidenceBridgeInput = {
      tenantId: 'tenant-1',
      decisionLogId: 'log-1',
      correlationId: 'corr-1',
      templateId: 'tmpl-1',
      decisionType: 'approval',
      candidate: makeCandidate(),
      inputPayload: { field_a: 'value_a' },
    };

    const evidence = bridgeDeterministicToEvidence(input);
    expect(evidence.tenantId).toBe('tenant-1');
    expect(evidence.correlationId).toBe('corr-1');
    expect(evidence.inputHash).toBeTruthy();
    expect(evidence.outputHash).toBeTruthy();
    expect(evidence.policyEvidenceHash).toBeTruthy();
    expect(evidence.policyEvidence.completeness).toBe('complete');
    expect(evidence.policyEvidence.missingDocumentIds).toHaveLength(0);
    expect(evidence.confidenceTier).toBe('provider');
    expect(evidence.deterministicCandidate.safeToExecuteWithoutModel).toBe(true);
  });

  it('sets outputHash to null when decision is null', () => {
    const input: DeterministicEvidenceBridgeInput = {
      tenantId: 'tenant-1',
      decisionLogId: 'log-1',
      correlationId: 'corr-1',
      templateId: 'tmpl-1',
      decisionType: 'approval',
      candidate: makeCandidate({ decision: null }),
      inputPayload: {},
    };

    const evidence = bridgeDeterministicToEvidence(input);
    expect(evidence.outputHash).toBeNull();
  });

  it('marks completeness as partial when evidence is missing', () => {
    const input: DeterministicEvidenceBridgeInput = {
      tenantId: 'tenant-1',
      decisionLogId: 'log-1',
      correlationId: 'corr-1',
      templateId: 'tmpl-1',
      decisionType: 'approval',
      candidate: makeCandidate({ missingEvidence: ['field_x', 'field_y'] }),
      inputPayload: {},
    };

    const evidence = bridgeDeterministicToEvidence(input);
    expect(evidence.policyEvidence.completeness).toBe('partial');
    expect(evidence.policyEvidence.missingDocumentIds).toEqual(['field_x', 'field_y']);
  });

  it('sets policyEvidenceHash to null when no rules fired', () => {
    const input: DeterministicEvidenceBridgeInput = {
      tenantId: 'tenant-1',
      decisionLogId: 'log-1',
      correlationId: 'corr-1',
      templateId: 'tmpl-1',
      decisionType: 'approval',
      candidate: makeCandidate({ rulesFired: [] }),
      inputPayload: {},
    };

    const evidence = bridgeDeterministicToEvidence(input);
    expect(evidence.policyEvidenceHash).toBeNull();
  });
});
