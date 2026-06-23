import { describe, it, expect } from 'vitest';
import { checkAbortConditions, hasHardAbort, hasSoftAbort } from './abort-conditions.js';

describe('checkAbortConditions', () => {
  it('returns POLICY_DENY hard abort when policy denies', () => {
    const conditions = checkAbortConditions({
      policyVerdict: 'deny',
      routeResolved: true,
      modelRequired: false,
      modelAvailable: false,
      qualityGateStatus: 'pass',
    });

    expect(conditions.length).toBeGreaterThan(0);
    expect(conditions[0].code).toBe('POLICY_DENY');
    expect(conditions[0].severity).toBe('hard');
    expect(hasHardAbort(conditions)).toBe(true);
  });

  it('returns QUALITY_GATE_FAIL hard abort when quality gate fails', () => {
    const conditions = checkAbortConditions({
      policyVerdict: 'allow',
      routeResolved: true,
      modelRequired: false,
      modelAvailable: false,
      qualityGateStatus: 'fail',
    });

    expect(conditions.some((c) => c.code === 'QUALITY_GATE_FAIL')).toBe(true);
    expect(hasHardAbort(conditions)).toBe(true);
  });

  it('returns MODEL_UNAVAILABLE soft abort when model needed but not available', () => {
    const conditions = checkAbortConditions({
      policyVerdict: 'allow',
      routeResolved: true,
      modelRequired: true,
      modelAvailable: false,
      qualityGateStatus: 'pass',
    });

    expect(conditions.some((c) => c.code === 'MODEL_UNAVAILABLE')).toBe(true);
    expect(hasSoftAbort(conditions)).toBe(true);
    expect(hasHardAbort(conditions)).toBe(false);
  });

  it('returns NO_ROUTE soft abort when no route resolved', () => {
    const conditions = checkAbortConditions({
      policyVerdict: 'allow',
      routeResolved: false,
      modelRequired: false,
      modelAvailable: false,
      qualityGateStatus: 'pass',
    });

    expect(conditions.some((c) => c.code === 'NO_ROUTE')).toBe(true);
    expect(hasSoftAbort(conditions)).toBe(true);
  });

  it('returns empty when everything is fine', () => {
    const conditions = checkAbortConditions({
      policyVerdict: 'allow',
      routeResolved: true,
      modelRequired: false,
      modelAvailable: true,
      qualityGateStatus: 'pass',
    });

    expect(conditions.length).toBe(0);
  });
});
