import { z } from 'zod';
import { RouteClassEnum } from './route-class.js';
import { ConfidenceTierEnum } from './deterministic-candidate.js';

export const SafetyDeltaSchema = z.object({
  deterministicUnsafe: z.boolean(),
  a5Unsafe: z.boolean(),
  deterministicDecision: z.string().nullable(),
  a5Decision: z.string().nullable(),
  fixtureExpected: z.string().nullable(),
  deterministicInUnsafeList: z.boolean(),
  a5InUnsafeList: z.boolean(),
});

export type SafetyDelta = z.infer<typeof SafetyDeltaSchema>;

export const MatchDeltaSchema = z.object({
  deterministicMatchesExpected: z.boolean(),
  deterministicMatchesAcceptable: z.boolean(),
  a5MatchesExpected: z.boolean(),
  a5MatchesAcceptable: z.boolean(),
});

export type MatchDelta = z.infer<typeof MatchDeltaSchema>;

export const CostDeltaSchema = z.object({
  a5ModelCalls: z.number().int().nonnegative(),
  deterministicModelCalls: z.literal(0),
  modelCallsSaved: z.number().int().nonnegative(),
});

export type CostDelta = z.infer<typeof CostDeltaSchema>;

export const EvidenceDeltaSchema = z.object({
  deterministicMissingEvidence: z.array(z.string()),
  a5MissingEvidence: z.array(z.string()),
  deterministicEvidenceComplete: z.boolean(),
  a5EvidenceComplete: z.boolean(),
});

export type EvidenceDelta = z.infer<typeof EvidenceDeltaSchema>;

export const ComparisonResultSchema = z.object({
  surfaceId: z.string().min(1),
  scenarioId: z.string().min(1),
  safety: SafetyDeltaSchema,
  match: MatchDeltaSchema,
  cost: CostDeltaSchema,
  evidence: EvidenceDeltaSchema,
  deterministicConfidenceTier: ConfidenceTierEnum,
  recommendedRouteClass: RouteClassEnum,
  notes: z.string(),
});

export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;
