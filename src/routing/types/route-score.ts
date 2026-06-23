import { z } from 'zod';
import { RouteClassEnum } from './route-class.js';

export const ScoringWeightsSchema = z.object({
  safety: z.number().min(0).max(1),
  match: z.number().min(0).max(1),
  evidence: z.number().min(0).max(1),
  cost: z.number().min(0).max(1),
  latency: z.number().min(0).max(1),
  simplicity: z.number().min(0).max(1),
});

export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  safety: 0.40,
  match: 0.20,
  evidence: 0.15,
  cost: 0.10,
  latency: 0.10,
  simplicity: 0.05,
};

export const HardBlockerReasonEnum = z.enum([
  'unsafe_deterministic_allow',
  'missing_critical_policy_evidence',
  'missing_required_input_evidence',
  'protected_attribute_hazard',
  'prose_surface',
  'deterministic_model_disagreement_high_impact',
  'unhashable_or_unauditable_route',
]);

export type HardBlockerReason = z.infer<typeof HardBlockerReasonEnum>;

export const HardBlockerSchema = z.object({
  reason: HardBlockerReasonEnum,
  surfaceId: z.string().min(1),
  description: z.string(),
  blocksRouteClass: z.array(RouteClassEnum),
});

export type HardBlocker = z.infer<typeof HardBlockerSchema>;

export const RouteScoreComponentsSchema = z.object({
  safety: z.number().min(0).max(1),
  match: z.number().min(0).max(1),
  evidence: z.number().min(0).max(1),
  cost: z.number().min(0).max(1),
  latency: z.number().min(0).max(1),
  simplicity: z.number().min(0).max(1),
});

export type RouteScoreComponents = z.infer<typeof RouteScoreComponentsSchema>;

export const RouteScoreSchema = z.object({
  surfaceId: z.string().min(1),
  recommendedRouteClass: RouteClassEnum,
  weightedTotal: z.number().min(0).max(1),
  components: RouteScoreComponentsSchema,
  weights: ScoringWeightsSchema,
  hardBlockers: z.array(HardBlockerSchema),
  hardBlockerCount: z.number().int().nonnegative(),
  rationale: z.string(),
});

export type RouteScore = z.infer<typeof RouteScoreSchema>;
