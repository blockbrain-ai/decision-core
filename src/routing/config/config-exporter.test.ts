import { describe, it, expect, beforeEach } from 'vitest';
import { exportRuntimeConfig } from './config-exporter.js';
import { clearExtractors, registerExtractor } from '../extractors/extractor-registry.js';
import type { RouteScore } from '../types/route-score.js';
import { DEFAULT_SCORING_WEIGHTS } from '../types/route-score.js';
import type { DeterministicExtractor, ExtractorContext } from '../extractors/extractor.types.js';
import type { DeterministicDecisionCandidate } from '../types/deterministic-candidate.js';

function makeScore(overrides: Partial<RouteScore> = {}): RouteScore {
  return {
    surfaceId: 'test.surface',
    recommendedRouteClass: 'deterministic_first_a5_on_uncertain',
    weightedTotal: 0.9,
    components: { safety: 1.0, match: 0.9, evidence: 0.85, cost: 0.8, latency: 0.9, simplicity: 0.8 },
    weights: { ...DEFAULT_SCORING_WEIGHTS },
    hardBlockers: [],
    hardBlockerCount: 0,
    rationale: 'Test score',
    ...overrides,
  };
}

class StubExtractor implements DeterministicExtractor {
  readonly extractorType = 'test';
  readonly ruleSetId: string;
  constructor(readonly surfaceId: string) {
    this.ruleSetId = `${surfaceId}:stub`;
  }
  extract(_p: Record<string, unknown>, _c: ExtractorContext): DeterministicDecisionCandidate {
    throw new Error('not called in this test');
  }
}

describe('exportRuntimeConfig', () => {
  beforeEach(() => {
    clearExtractors();
  });

  it('exports config with valid hash', () => {
    const config = exportRuntimeConfig({
      enterpriseId: 'ent-1',
      scores: [makeScore()],
      optimizerVersion: '0.1.0',
    });

    expect(config.version).toBe('1.0.0');
    expect(config.enterpriseId).toBe('ent-1');
    expect(config.surfaces).toHaveLength(1);
    expect(config.configHash).toBeTruthy();
    expect(config.configHash.length).toBe(64);
  });

  it('derives confidence threshold per route class', () => {
    const scores = [
      makeScore({ surfaceId: 'a', recommendedRouteClass: 'deterministic_only' }),
      makeScore({ surfaceId: 'b', recommendedRouteClass: 'deterministic_first_a5_on_uncertain' }),
      makeScore({ surfaceId: 'c', recommendedRouteClass: 'deterministic_guardrail_then_a5' }),
      makeScore({ surfaceId: 'd', recommendedRouteClass: 'a5_default_with_deterministic_validator' }),
    ];

    const config = exportRuntimeConfig({ enterpriseId: 'ent-1', scores, optimizerVersion: '0.1.0' });
    const surfaceMap = new Map(config.surfaces.map(s => [s.surfaceId, s]));

    expect(surfaceMap.get('a')!.confidenceThreshold).toBe(0.99);
    expect(surfaceMap.get('b')!.confidenceThreshold).toBe(0.90);
    expect(surfaceMap.get('c')!.confidenceThreshold).toBe(0.70);
    expect(surfaceMap.get('d')!.confidenceThreshold).toBe(0.50);
  });

  it('derives fallback pattern per route class', () => {
    const scores = [
      makeScore({ surfaceId: 'a', recommendedRouteClass: 'deterministic_only' }),
      makeScore({ surfaceId: 'b', recommendedRouteClass: 'frontier_or_human_required' }),
    ];

    const config = exportRuntimeConfig({ enterpriseId: 'ent-1', scores, optimizerVersion: '0.1.0' });
    const surfaceMap = new Map(config.surfaces.map(s => [s.surfaceId, s]));

    expect(surfaceMap.get('a')!.fallbackPattern).toBe('safe_block');
    expect(surfaceMap.get('b')!.fallbackPattern).toBe('human_review');
  });

  it('sets frontierShadow only for a5_plus_frontier_shadow', () => {
    const scores = [
      makeScore({ surfaceId: 'a', recommendedRouteClass: 'a5_plus_frontier_shadow' }),
      makeScore({ surfaceId: 'b', recommendedRouteClass: 'deterministic_only' }),
    ];

    const config = exportRuntimeConfig({ enterpriseId: 'ent-1', scores, optimizerVersion: '0.1.0' });
    const surfaceMap = new Map(config.surfaces.map(s => [s.surfaceId, s]));

    expect(surfaceMap.get('a')!.frontierShadow).toBe(true);
    expect(surfaceMap.get('b')!.frontierShadow).toBe(false);
  });

  it('includes extractor ID when extractor is registered', () => {
    registerExtractor(new StubExtractor('test.surface'));
    const config = exportRuntimeConfig({
      enterpriseId: 'ent-1',
      scores: [makeScore()],
      optimizerVersion: '0.1.0',
    });

    expect(config.surfaces[0].deterministicExtractorId).toBe('test.surface:stub');
  });

  it('sets deterministicExtractorId to null when no extractor', () => {
    const config = exportRuntimeConfig({
      enterpriseId: 'ent-1',
      scores: [makeScore()],
      optimizerVersion: '0.1.0',
    });

    expect(config.surfaces[0].deterministicExtractorId).toBeNull();
  });
});
