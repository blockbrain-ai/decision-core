import type { RouteScore, RouteScoreComponents, ScoringWeights } from '../types/route-score.js';
import type { RouteClass } from '../types/route-class.js';
import { ROUTE_CLASS_PRIORITY } from '../types/route-class.js';
import { evaluateHardBlockers, isRouteBlocked, type HardBlockerInput } from './hard-blockers.js';
import { getDefaultWeights, validateWeights } from './scoring-weights.js';

export interface RouteOptimizerInput {
  surfaceId: string;
  components: RouteScoreComponents;
  blockerInput: HardBlockerInput;
  weights?: ScoringWeights;
}

const CANDIDATE_ROUTE_CLASSES: RouteClass[] = [
  'deterministic_only',
  'deterministic_first_a5_on_uncertain',
  'deterministic_guardrail_then_a5',
  'a5_default_with_deterministic_validator',
  'a5_plus_frontier_shadow',
  'frontier_or_human_required',
];

export function scoreRoute(input: RouteOptimizerInput): RouteScore {
  const weights = input.weights ? validateWeights(input.weights) : getDefaultWeights();
  const { components, blockerInput, surfaceId } = input;

  const hardBlockers = evaluateHardBlockers(blockerInput);
  const weightedTotal =
    components.safety * weights.safety +
    components.match * weights.match +
    components.evidence * weights.evidence +
    components.cost * weights.cost +
    components.latency * weights.latency +
    components.simplicity * weights.simplicity;

  const recommended = selectBestRoute(components, hardBlockers, weightedTotal);

  return {
    surfaceId,
    recommendedRouteClass: recommended,
    weightedTotal: Math.round(weightedTotal * 10000) / 10000,
    components,
    weights,
    hardBlockers,
    hardBlockerCount: hardBlockers.length,
    rationale: buildRationale(recommended, hardBlockers, components, weightedTotal),
  };
}

function selectBestRoute(
  components: RouteScoreComponents,
  hardBlockers: ReturnType<typeof evaluateHardBlockers>,
  _weightedTotal: number,
): RouteClass {
  if (components.safety < 1.0) {
    return 'frontier_or_human_required';
  }

  for (const candidate of CANDIDATE_ROUTE_CLASSES) {
    if (!isRouteBlocked(hardBlockers, candidate)) {
      if (candidate === 'deterministic_only' && components.match < 0.95) continue;
      if (candidate === 'deterministic_first_a5_on_uncertain' && components.match < 0.80) continue;
      if (candidate === 'deterministic_guardrail_then_a5' && components.match < 0.50) continue;
      return candidate;
    }
  }

  return 'frontier_or_human_required';
}

function buildRationale(
  route: RouteClass,
  hardBlockers: ReturnType<typeof evaluateHardBlockers>,
  components: RouteScoreComponents,
  weightedTotal: number,
): string {
  const parts: string[] = [];

  parts.push(`Selected route: ${route} (priority ${ROUTE_CLASS_PRIORITY[route]})`);
  parts.push(`Weighted score: ${(weightedTotal * 100).toFixed(1)}%`);

  if (hardBlockers.length > 0) {
    parts.push(`Hard blockers (${hardBlockers.length}): ${hardBlockers.map(b => b.reason).join(', ')}`);
  }

  if (components.safety < 1.0) {
    parts.push(`Safety score below 1.0 (${components.safety}) — forced to frontier/human`);
  }

  return parts.join('. ');
}

export function classifySurfaceNotReady(surfaceId: string, reason: string): RouteScore {
  return {
    surfaceId,
    recommendedRouteClass: 'not_ready_data_or_policy_gap',
    weightedTotal: 0,
    components: { safety: 0, match: 0, evidence: 0, cost: 0, latency: 0, simplicity: 0 },
    weights: getDefaultWeights(),
    hardBlockers: [],
    hardBlockerCount: 0,
    rationale: `Not ready: ${reason}`,
  };
}
