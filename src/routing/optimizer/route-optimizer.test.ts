import { describe, it, expect } from 'vitest';
import { scoreRoute, classifySurfaceNotReady, type RouteOptimizerInput } from './route-optimizer.js';
import type { RouteScoreComponents } from '../types/route-score.js';
import type { HardBlockerInput } from './hard-blockers.js';

function makeComponents(overrides: Partial<RouteScoreComponents> = {}): RouteScoreComponents {
  return { safety: 1.0, match: 0.9, evidence: 0.85, cost: 0.8, latency: 0.9, simplicity: 0.8, ...overrides };
}

function makeBlockerInput(overrides: Partial<HardBlockerInput> = {}): HardBlockerInput {
  return {
    surfaceId: 'test.surface',
    protectedAttributeHazard: false,
    proseSurface: false,
    deterministicUnsafeAllowCount: 0,
    missingCriticalPolicyEvidence: false,
    missingRequiredInputEvidence: false,
    deterministicModelDisagreementOnHighImpact: false,
    unhashableOrUnauditable: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<RouteOptimizerInput> = {}): RouteOptimizerInput {
  return {
    surfaceId: 'test.surface',
    components: makeComponents(),
    blockerInput: makeBlockerInput(),
    ...overrides,
  };
}

describe('scoreRoute', () => {
  it('scores with default weights', () => {
    const result = scoreRoute(makeInput());
    expect(result.surfaceId).toBe('test.surface');
    expect(result.weightedTotal).toBeGreaterThan(0);
    expect(result.weightedTotal).toBeLessThanOrEqual(1);
    expect(result.hardBlockerCount).toBe(0);
  });

  it('weighted total is correct calculation', () => {
    const components = { safety: 1.0, match: 1.0, evidence: 1.0, cost: 1.0, latency: 1.0, simplicity: 1.0 };
    const result = scoreRoute(makeInput({ components: components }));
    expect(result.weightedTotal).toBe(1.0);
  });

  it('selects deterministic_only for perfect match score', () => {
    const result = scoreRoute(makeInput({
      components: makeComponents({ safety: 1.0, match: 0.99 }),
    }));
    expect(result.recommendedRouteClass).toBe('deterministic_only');
  });

  it('selects deterministic_first_a5_on_uncertain for high match', () => {
    const result = scoreRoute(makeInput({
      components: makeComponents({ match: 0.85 }),
    }));
    expect(result.recommendedRouteClass).toBe('deterministic_first_a5_on_uncertain');
  });

  it('forces frontier_or_human_required when safety < 1.0', () => {
    const result = scoreRoute(makeInput({
      components: makeComponents({ safety: 0.8 }),
    }));
    expect(result.recommendedRouteClass).toBe('frontier_or_human_required');
    expect(result.rationale).toContain('Safety score below 1.0');
  });

  it('falls through to model routes when match is low', () => {
    const result = scoreRoute(makeInput({
      components: makeComponents({ match: 0.3 }),
    }));
    expect(result.recommendedRouteClass).toBe('a5_default_with_deterministic_validator');
  });

  it('blocks deterministic routes with hard blockers', () => {
    const result = scoreRoute(makeInput({
      components: makeComponents({ match: 0.99 }),
      blockerInput: makeBlockerInput({ missingCriticalPolicyEvidence: true }),
    }));
    expect(result.recommendedRouteClass).not.toBe('deterministic_only');
    expect(result.hardBlockerCount).toBe(1);
    expect(result.rationale).toContain('Hard blockers');
  });

  it('forces frontier/human on protected attribute hazard', () => {
    const result = scoreRoute(makeInput({
      blockerInput: makeBlockerInput({ protectedAttributeHazard: true }),
    }));
    expect(result.recommendedRouteClass).toBe('frontier_or_human_required');
  });

  it('accepts custom weights', () => {
    const result = scoreRoute(makeInput({
      weights: { safety: 0.5, match: 0.2, evidence: 0.1, cost: 0.1, latency: 0.05, simplicity: 0.05 },
    }));
    expect(result.weights.safety).toBe(0.5);
  });

  it('rejects weights that do not sum to 1.0', () => {
    expect(() => scoreRoute(makeInput({
      weights: { safety: 0.5, match: 0.5, evidence: 0.5, cost: 0.5, latency: 0.5, simplicity: 0.5 },
    }))).toThrow('Scoring weights must sum to 1.0');
  });

  it('rationale includes selected route and score', () => {
    const result = scoreRoute(makeInput());
    expect(result.rationale).toContain('Selected route:');
    expect(result.rationale).toContain('Weighted score:');
  });
});

describe('classifySurfaceNotReady', () => {
  it('returns not_ready with zero scores', () => {
    const result = classifySurfaceNotReady('incomplete.surface', 'missing data pipeline');
    expect(result.recommendedRouteClass).toBe('not_ready_data_or_policy_gap');
    expect(result.weightedTotal).toBe(0);
    expect(result.rationale).toContain('missing data pipeline');
  });
});
