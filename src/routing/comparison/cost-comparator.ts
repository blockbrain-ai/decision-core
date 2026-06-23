import type { CostDelta } from '../types/comparison-result.js';

export interface CostComparatorInput {
  a5ModelCalls: number;
}

export function compareCost(input: CostComparatorInput): CostDelta {
  return {
    a5ModelCalls: input.a5ModelCalls,
    deterministicModelCalls: 0 as const,
    modelCallsSaved: input.a5ModelCalls,
  };
}
