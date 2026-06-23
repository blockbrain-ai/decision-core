import { describe, it, expect } from 'vitest';
import { buildProvenanceMetadata, COMPILER_VERSION, ProvenanceMetadataSchema } from './provenance-metadata.js';

describe('ProvenanceMetadata', () => {
  it('builds with default compiler version', () => {
    const meta = buildProvenanceMetadata();
    expect(meta.compilerVersion).toBe(COMPILER_VERSION);
    expect(meta.authoringSchemaVersion).toBeUndefined();
    expect(meta.policyFileHash).toBeUndefined();
    expect(meta.linterStatus).toBeUndefined();
  });

  it('includes all provided fields', () => {
    const meta = buildProvenanceMetadata({
      authoringSchemaVersion: '1.0.0',
      policyFileHash: 'abc123',
      linterStatus: { errorCount: 0, warningCount: 2, lintedAt: '2026-05-06T00:00:00Z' },
      ruleSetHash: 'rules456',
      sourceDocumentId: 'doc789',
    });
    expect(meta.compilerVersion).toBe(COMPILER_VERSION);
    expect(meta.authoringSchemaVersion).toBe('1.0.0');
    expect(meta.policyFileHash).toBe('abc123');
    expect(meta.linterStatus!.errorCount).toBe(0);
    expect(meta.linterStatus!.warningCount).toBe(2);
    expect(meta.ruleSetHash).toBe('rules456');
    expect(meta.sourceDocumentId).toBe('doc789');
  });

  it('validates against the Zod schema', () => {
    const meta = buildProvenanceMetadata({ authoringSchemaVersion: '1.0.0' });
    expect(() => ProvenanceMetadataSchema.parse(meta)).not.toThrow();
  });

  it('rejects invalid schema values', () => {
    expect(() => ProvenanceMetadataSchema.parse({ compilerVersion: 123 })).toThrow();
  });
});

describe('ClauseEvidence extended fields', () => {
  it('allows optional provenance fields on ClauseEvidence', () => {
    const evidence: import('./deterministic-enforcer.js').ClauseEvidence = {
      clauseId: 'c1',
      clauseText: 'test',
      controlId: null,
      ruleId: 'r1',
      ruleType: 'threshold',
      inputFields: {},
      result: 'pass',
      explanation: 'passed',
      sourceLineRef: { file: 'test.md', startLine: 1, endLine: 5 },
      conditionHash: 'sha256:abc',
      authoringSchemaVersion: '1.0.0',
      surfaceId: 'finance.processing',
    };
    expect(evidence.sourceLineRef!.file).toBe('test.md');
    expect(evidence.conditionHash).toBe('sha256:abc');
    expect(evidence.surfaceId).toBe('finance.processing');
  });
});

describe('ClauseProvenancePayload extended fields', () => {
  it('allows optional provenance fields', () => {
    const payload: import('./clause-evidence-recorder.js').ClauseProvenancePayload = {
      ruleSetId: 'rs1',
      ruleSetVersion: 1,
      enforcementPassed: true,
      totalRules: 1,
      passedRules: 1,
      failedRules: 0,
      clauseEvidence: [],
      blockedByRuleIds: [],
      compilerVersion: COMPILER_VERSION,
      policyFileHash: 'abc123',
      linterStatus: { errorCount: 0, warningCount: 0, lintedAt: '2026-05-06T00:00:00Z' },
      ruleSetHash: 'sha256:def456',
      sourceDocumentId: 'dc.finance.001',
    };
    expect(payload.compilerVersion).toBe(COMPILER_VERSION);
    expect(payload.ruleSetHash).toBe('sha256:def456');
    expect(payload.sourceDocumentId).toBe('dc.finance.001');
  });
});
