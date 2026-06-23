import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerExtractor,
  getExtractor,
  getAllExtractors,
  hasExtractor,
  getExtractorIds,
  clearExtractors,
} from './extractor-registry.js';
import type { DeterministicExtractor, ExtractorContext } from './extractor.types.js';
import type { DeterministicDecisionCandidate } from '../types/deterministic-candidate.js';

class TestExtractor implements DeterministicExtractor {
  readonly extractorType = 'test';
  readonly ruleSetId: string;

  constructor(readonly surfaceId: string) {
    this.ruleSetId = `${surfaceId}:test`;
  }

  extract(_payload: Record<string, unknown>, context: ExtractorContext): DeterministicDecisionCandidate {
    return {
      surfaceId: this.surfaceId,
      routeClass: 'deterministic_first_a5_on_uncertain',
      decision: 'approve',
      confidence: 0.95,
      confidenceTier: 'high',
      ruleSetId: this.ruleSetId,
      ruleSetVersion: context.ruleSetVersion,
      ruleSetHash: 'test-hash',
      rulesFired: [],
      missingEvidence: [],
      usedInputFields: [],
      ignoredUntrustedFields: [],
      rationale: 'Test extractor',
      safeToExecuteWithoutModel: true,
    };
  }
}

describe('extractor-registry', () => {
  beforeEach(() => {
    clearExtractors();
  });

  it('starts empty', () => {
    expect(getAllExtractors().size).toBe(0);
    expect(getExtractorIds()).toEqual([]);
  });

  it('registers and retrieves an extractor', () => {
    const extractor = new TestExtractor('test.surface');
    registerExtractor(extractor);
    expect(getExtractor('test.surface')).toBe(extractor);
    expect(hasExtractor('test.surface')).toBe(true);
  });

  it('returns undefined for unregistered surface', () => {
    expect(getExtractor('nonexistent')).toBeUndefined();
    expect(hasExtractor('nonexistent')).toBe(false);
  });

  it('lists all registered extractor IDs', () => {
    registerExtractor(new TestExtractor('surface.a'));
    registerExtractor(new TestExtractor('surface.b'));
    const ids = getExtractorIds();
    expect(ids).toContain('surface.a');
    expect(ids).toContain('surface.b');
    expect(ids).toHaveLength(2);
  });

  it('overwrites extractor for same surfaceId', () => {
    const extractor1 = new TestExtractor('test.surface');
    const extractor2 = new TestExtractor('test.surface');
    registerExtractor(extractor1);
    registerExtractor(extractor2);
    expect(getExtractor('test.surface')).toBe(extractor2);
    expect(getAllExtractors().size).toBe(1);
  });

  it('clearExtractors removes all', () => {
    registerExtractor(new TestExtractor('surface.a'));
    registerExtractor(new TestExtractor('surface.b'));
    clearExtractors();
    expect(getAllExtractors().size).toBe(0);
  });

  it('extractor can extract a candidate', () => {
    const extractor = new TestExtractor('test.surface');
    registerExtractor(extractor);

    const retrieved = getExtractor('test.surface')!;
    const candidate = retrieved.extract({}, {
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      surfaceId: 'test.surface',
      ruleSetVersion: '1.0.0',
      untrustedPayloadKeys: [],
    });
    expect(candidate.surfaceId).toBe('test.surface');
    expect(candidate.safeToExecuteWithoutModel).toBe(true);
  });
});
