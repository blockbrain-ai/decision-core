import { describe, it, expect, beforeEach } from 'vitest';
import { RuntimeRouteResolver } from './runtime-route-resolver.js';
import { EnterpriseRouteConfigLoader } from '../config/config-loader.js';
import { registerExtractor, clearExtractors } from '../extractors/extractor-registry.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';
import type { DeterministicExtractor, ExtractorContext } from '../extractors/extractor.types.js';
import type { DeterministicDecisionCandidate } from '../types/deterministic-candidate.js';
import type { RuntimeRouteConfig, RuntimeSurfaceRoute } from '../types/runtime-config.js';

function makeSurface(overrides: Partial<RuntimeSurfaceRoute> = {}): RuntimeSurfaceRoute {
  return {
    surfaceId: 'test.surface',
    routeClass: 'deterministic_first_a5_on_uncertain',
    deterministicExtractorId: null,
    confidenceThreshold: 0.9,
    fallbackPattern: 'a5_hybrid',
    frontierShadow: false,
    humanReviewOnDisagreement: false,
    policyEvidenceRequired: true,
    scoreSummary: { weightedTotal: 0.85, hardBlockerCount: 0 },
    ...overrides,
  };
}

function makeConfig(surfaces: RuntimeSurfaceRoute[]): RuntimeRouteConfig {
  const configHash = hashCanonicalJson({
    version: '1.0.0',
    enterpriseId: 'test-enterprise',
    optimizerVersion: '0.1.0',
    surfaces,
  });
  return {
    version: '1.0.0',
    generatedAt: '2026-05-02T00:00:00.000Z',
    enterpriseId: 'test-enterprise',
    configHash,
    optimizerVersion: '0.1.0',
    surfaces,
  };
}

class TestExtractor implements DeterministicExtractor {
  readonly extractorType = 'test';
  readonly ruleSetId: string;
  constructor(
    readonly surfaceId: string,
    private readonly result: Partial<DeterministicDecisionCandidate> = {},
  ) {
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
      ...this.result,
    };
  }
}

class ThrowingExtractor implements DeterministicExtractor {
  readonly extractorType = 'test';
  readonly ruleSetId = 'test:throwing';
  constructor(readonly surfaceId: string) {}
  extract(): DeterministicDecisionCandidate {
    throw new Error('extractor failed');
  }
}

describe('RuntimeRouteResolver', () => {
  beforeEach(() => {
    clearExtractors();
  });

  it('returns null for unknown surface', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([]));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('unknown.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result).toBeNull();
  });

  it('safe-blocks not_ready_data_or_policy_gap surfaces', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'not_ready_data_or_policy_gap' }),
    ]));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result).not.toBeNull();
    expect(result!.skipModelCall).toBe(true);
    expect(result!.candidate?.safeToExecuteWithoutModel).toBe(false);
    expect(result!.reason).toContain('safe-block');
  });

  it('safe-blocks frontier_or_human_required surfaces', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'frontier_or_human_required' }),
    ]));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(true);
    expect(result!.reason).toContain('safe-block');
  });

  it('requires model for non-deterministic routes', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'a5_default_with_deterministic_validator' }),
    ]));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(false);
    expect(result!.candidate).toBeNull();
    expect(result!.reason).toContain('requires model evaluation');
  });

  it('falls back to model when no extractor registered for deterministic surface', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'deterministic_only' }),
    ]));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(false);
    expect(result!.reason).toContain('no deterministic extractor');
  });

  it('skips model when extractor succeeds with high confidence', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'deterministic_first_a5_on_uncertain', confidenceThreshold: 0.9 }),
    ]));
    registerExtractor(new TestExtractor('test.surface', { confidence: 0.95, safeToExecuteWithoutModel: true }));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(true);
    expect(result!.candidate).not.toBeNull();
    expect(result!.reason).toContain('deterministic resolution');
  });

  it('falls through to model when confidence is below threshold', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'deterministic_first_a5_on_uncertain', confidenceThreshold: 0.9 }),
    ]));
    registerExtractor(new TestExtractor('test.surface', { confidence: 0.7, safeToExecuteWithoutModel: true }));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(false);
    expect(result!.reason).toContain('below threshold');
  });

  it('falls through when safeToExecuteWithoutModel is false', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'deterministic_first_a5_on_uncertain', confidenceThreshold: 0.9 }),
    ]));
    registerExtractor(new TestExtractor('test.surface', { confidence: 0.95, safeToExecuteWithoutModel: false }));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(false);
  });

  it('falls through when decision is null', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'deterministic_first_a5_on_uncertain', confidenceThreshold: 0.9 }),
    ]));
    registerExtractor(new TestExtractor('test.surface', { confidence: 0.95, decision: null }));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(false);
  });

  it('handles extractor that throws', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'deterministic_only' }),
    ]));
    registerExtractor(new ThrowingExtractor('test.surface'));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(false);
    expect(result!.reason).toContain('extractor failed');
  });

  it('deterministic_only surface fails safely when below threshold', () => {
    const loader = new EnterpriseRouteConfigLoader();
    loader.loadFromObject(makeConfig([
      makeSurface({ routeClass: 'deterministic_only', confidenceThreshold: 0.99 }),
    ]));
    registerExtractor(new TestExtractor('test.surface', { confidence: 0.8 }));
    const resolver = new RuntimeRouteResolver(loader);
    const result = resolver.resolve('test.surface', {}, { tenantId: 't1', correlationId: 'c1' });
    expect(result!.skipModelCall).toBe(false);
    expect(result!.reason).toContain('failed confidence/safety check');
    expect(result!.reason).toContain('falling back to');
  });

  it('loadConfigFromJson works', () => {
    const resolver = new RuntimeRouteResolver();
    const config = makeConfig([makeSurface()]);
    resolver.loadConfigFromJson(JSON.stringify(config));
    expect(resolver.isLoaded()).toBe(true);
  });
});
