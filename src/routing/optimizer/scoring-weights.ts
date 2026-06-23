import type { ScoringWeights } from '../types/route-score.js';
import { DEFAULT_SCORING_WEIGHTS, ScoringWeightsSchema } from '../types/route-score.js';

export function validateWeights(weights: ScoringWeights): ScoringWeights {
  const parsed = ScoringWeightsSchema.parse(weights);
  const sum = parsed.safety + parsed.match + parsed.evidence + parsed.cost + parsed.latency + parsed.simplicity;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`Scoring weights must sum to 1.0, got ${sum.toFixed(4)}`);
  }
  return parsed;
}

export function getDefaultWeights(): ScoringWeights {
  return { ...DEFAULT_SCORING_WEIGHTS };
}
