import type { MatchDelta } from '../types/comparison-result.js';

export interface MatchComparatorInput {
  deterministicDecision: string | null;
  a5Decision: string | null;
  fixtureExpected: string | null;
  fixtureAcceptable: string[];
}

export function compareMatch(input: MatchComparatorInput): MatchDelta {
  const { deterministicDecision, a5Decision, fixtureExpected, fixtureAcceptable } = input;
  const acceptableSet = new Set(fixtureAcceptable.map(d => d.toLowerCase()));
  if (fixtureExpected) {
    acceptableSet.add(fixtureExpected.toLowerCase());
  }

  const detLower = deterministicDecision?.toLowerCase() ?? null;
  const a5Lower = a5Decision?.toLowerCase() ?? null;
  const expectedLower = fixtureExpected?.toLowerCase() ?? null;

  return {
    deterministicMatchesExpected: detLower !== null && expectedLower !== null && detLower === expectedLower,
    deterministicMatchesAcceptable: detLower !== null && acceptableSet.has(detLower),
    a5MatchesExpected: a5Lower !== null && expectedLower !== null && a5Lower === expectedLower,
    a5MatchesAcceptable: a5Lower !== null && acceptableSet.has(a5Lower),
  };
}
