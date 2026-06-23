import { z } from 'zod';

export const RouteClassEnum = z.enum([
  'deterministic_only',
  'deterministic_first_a5_on_uncertain',
  'deterministic_guardrail_then_a5',
  'a5_default_with_deterministic_validator',
  'a5_plus_frontier_shadow',
  'frontier_or_human_required',
  'not_ready_data_or_policy_gap',
]);

export type RouteClass = z.infer<typeof RouteClassEnum>;

export const ROUTE_CLASS_PRIORITY: Record<RouteClass, number> = {
  deterministic_only: 0,
  deterministic_first_a5_on_uncertain: 1,
  deterministic_guardrail_then_a5: 2,
  a5_default_with_deterministic_validator: 3,
  a5_plus_frontier_shadow: 4,
  frontier_or_human_required: 5,
  not_ready_data_or_policy_gap: 6,
};
