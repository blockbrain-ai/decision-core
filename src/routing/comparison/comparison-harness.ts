import type { ComparisonResult } from '../types/comparison-result.js';
import type { DeterministicDecisionCandidate } from '../types/deterministic-candidate.js';
import type { RouteClass } from '../types/route-class.js';
import { compareSafety, type SafetyComparatorInput } from './safety-comparator.js';
import { compareMatch, type MatchComparatorInput } from './match-comparator.js';
import { compareCost } from './cost-comparator.js';
import { compareEvidence } from './evidence-comparator.js';

export interface A5ResultRecord {
  surfaceId: string;
  scenarioId: string;
  decision: string | null;
  path: string;
  modelCallCount: number;
  unsafe: boolean;
  missingEvidence: string[];
}

export interface FixtureRecord {
  surfaceId: string;
  scenarioId: string;
  expectedDecision: string | null;
  acceptableDecisions: string[];
  unsafeDecisions: string[];
}

export interface ComparisonHarnessInput {
  candidate: DeterministicDecisionCandidate;
  a5Result: A5ResultRecord;
  fixture: FixtureRecord;
}

export function runComparison(input: ComparisonHarnessInput): ComparisonResult {
  const { candidate, a5Result, fixture } = input;

  const safetyInput: SafetyComparatorInput = {
    deterministicDecision: candidate.decision,
    a5Decision: a5Result.decision,
    fixtureExpected: fixture.expectedDecision,
    unsafeDecisions: fixture.unsafeDecisions,
  };

  const matchInput: MatchComparatorInput = {
    deterministicDecision: candidate.decision,
    a5Decision: a5Result.decision,
    fixtureExpected: fixture.expectedDecision,
    fixtureAcceptable: fixture.acceptableDecisions,
  };

  const safety = compareSafety(safetyInput);
  const match = compareMatch(matchInput);
  const cost = compareCost({ a5ModelCalls: a5Result.modelCallCount });
  const evidence = compareEvidence({
    deterministicMissingEvidence: candidate.missingEvidence,
    a5MissingEvidence: a5Result.missingEvidence,
  });

  const recommendedRouteClass = inferRouteClass(candidate, safety.deterministicUnsafe, match.deterministicMatchesAcceptable);

  const notes = buildNotes(candidate, safety, match);

  return {
    surfaceId: candidate.surfaceId,
    scenarioId: fixture.scenarioId,
    safety,
    match,
    cost,
    evidence,
    deterministicConfidenceTier: candidate.confidenceTier,
    recommendedRouteClass,
    notes,
  };
}

function inferRouteClass(
  candidate: DeterministicDecisionCandidate,
  deterministicUnsafe: boolean,
  deterministicMatchesAcceptable: boolean,
): RouteClass {
  if (deterministicUnsafe) {
    return 'frontier_or_human_required';
  }

  if (!candidate.safeToExecuteWithoutModel) {
    return candidate.routeClass;
  }

  if (candidate.confidenceTier === 'hard_rule' && deterministicMatchesAcceptable) {
    return 'deterministic_only';
  }

  if (candidate.confidenceTier === 'high' && deterministicMatchesAcceptable) {
    return 'deterministic_first_a5_on_uncertain';
  }

  if (candidate.decision !== null && !deterministicMatchesAcceptable) {
    return 'a5_default_with_deterministic_validator';
  }

  return candidate.routeClass;
}

function buildNotes(
  candidate: DeterministicDecisionCandidate,
  safety: ReturnType<typeof compareSafety>,
  match: ReturnType<typeof compareMatch>,
): string {
  const parts: string[] = [];

  if (safety.deterministicUnsafe) {
    parts.push('UNSAFE: deterministic path produced unsafe decision');
  }

  if (candidate.decision === null) {
    parts.push('Deterministic produced no decision');
  }

  if (!match.deterministicMatchesAcceptable && candidate.decision !== null) {
    parts.push(`Deterministic decision "${candidate.decision}" not in acceptable set`);
  }

  if (candidate.missingEvidence.length > 0) {
    parts.push(`Missing evidence: ${candidate.missingEvidence.join(', ')}`);
  }

  return parts.join('; ') || 'OK';
}

export function runBatchComparison(inputs: ComparisonHarnessInput[]): ComparisonResult[] {
  return inputs.map(runComparison);
}
