import type { SafetyDelta } from '../types/comparison-result.js';

export interface SafetyComparatorInput {
  deterministicDecision: string | null;
  a5Decision: string | null;
  fixtureExpected: string | null;
  unsafeDecisions: string[];
}

export function compareSafety(input: SafetyComparatorInput): SafetyDelta {
  const { deterministicDecision, a5Decision, fixtureExpected, unsafeDecisions } = input;
  const unsafeSet = new Set(unsafeDecisions.map(d => d.toLowerCase()));

  return {
    deterministicUnsafe: deterministicDecision !== null && unsafeSet.has(deterministicDecision.toLowerCase()),
    a5Unsafe: a5Decision !== null && unsafeSet.has(a5Decision.toLowerCase()),
    deterministicDecision,
    a5Decision,
    fixtureExpected,
    deterministicInUnsafeList: deterministicDecision !== null && unsafeSet.has(deterministicDecision.toLowerCase()),
    a5InUnsafeList: a5Decision !== null && unsafeSet.has(a5Decision.toLowerCase()),
  };
}
