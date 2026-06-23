import { describe, it, expect } from 'vitest';
import { evaluateHardBlockers, isRouteBlocked, type HardBlockerInput } from './hard-blockers.js';

function makeInput(overrides: Partial<HardBlockerInput> = {}): HardBlockerInput {
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

describe('evaluateHardBlockers', () => {
  it('returns empty array when no blockers are triggered', () => {
    const blockers = evaluateHardBlockers(makeInput());
    expect(blockers).toHaveLength(0);
  });

  it('blocks on missing required input evidence', () => {
    const blockers = evaluateHardBlockers(makeInput({ missingRequiredInputEvidence: true }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toBe('missing_required_input_evidence');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_only');
  });

  it('blocks on missing critical policy evidence', () => {
    const blockers = evaluateHardBlockers(makeInput({ missingCriticalPolicyEvidence: true }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toBe('missing_critical_policy_evidence');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_only');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_first_a5_on_uncertain');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_guardrail_then_a5');
  });

  it('blocks on protected attribute hazard — blocks all local autonomy routes', () => {
    const blockers = evaluateHardBlockers(makeInput({ protectedAttributeHazard: true }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toBe('protected_attribute_hazard');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_only');
    expect(blockers[0].blocksRouteClass).toContain('a5_default_with_deterministic_validator');
    expect(blockers[0].blocksRouteClass).toContain('a5_plus_frontier_shadow');
  });

  it('blocks on unsafe deterministic allow', () => {
    const blockers = evaluateHardBlockers(makeInput({ deterministicUnsafeAllowCount: 3 }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toBe('unsafe_deterministic_allow');
    expect(blockers[0].description).toContain('3');
  });

  it('blocks on prose surface', () => {
    const blockers = evaluateHardBlockers(makeInput({ proseSurface: true }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toBe('prose_surface');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_only');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_first_a5_on_uncertain');
  });

  it('blocks on deterministic-model disagreement on high impact', () => {
    const blockers = evaluateHardBlockers(makeInput({ deterministicModelDisagreementOnHighImpact: true }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toBe('deterministic_model_disagreement_high_impact');
  });

  it('blocks on unhashable/unauditable route', () => {
    const blockers = evaluateHardBlockers(makeInput({ unhashableOrUnauditable: true }));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toBe('unhashable_or_unauditable_route');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_only');
    expect(blockers[0].blocksRouteClass).toContain('deterministic_guardrail_then_a5');
  });

  it('accumulates multiple blockers', () => {
    const blockers = evaluateHardBlockers(makeInput({
      missingCriticalPolicyEvidence: true,
      protectedAttributeHazard: true,
      proseSurface: true,
    }));
    expect(blockers).toHaveLength(3);
    const reasons = blockers.map(b => b.reason);
    expect(reasons).toContain('missing_critical_policy_evidence');
    expect(reasons).toContain('protected_attribute_hazard');
    expect(reasons).toContain('prose_surface');
  });
});

describe('isRouteBlocked', () => {
  it('returns false for empty blockers', () => {
    expect(isRouteBlocked([], 'deterministic_only')).toBe(false);
  });

  it('returns true when route class is in a blocker', () => {
    const blockers = evaluateHardBlockers(makeInput({ protectedAttributeHazard: true }));
    expect(isRouteBlocked(blockers, 'deterministic_only')).toBe(true);
    expect(isRouteBlocked(blockers, 'a5_plus_frontier_shadow')).toBe(true);
  });

  it('returns false for unblocked route class', () => {
    const blockers = evaluateHardBlockers(makeInput({ protectedAttributeHazard: true }));
    expect(isRouteBlocked(blockers, 'frontier_or_human_required')).toBe(false);
  });
});
