import type { HardBlocker } from '../types/route-score.js';
import type { RouteClass } from '../types/route-class.js';

export interface HardBlockerInput {
  surfaceId: string;
  protectedAttributeHazard: boolean;
  proseSurface: boolean;
  deterministicUnsafeAllowCount: number;
  missingCriticalPolicyEvidence: boolean;
  missingRequiredInputEvidence: boolean;
  deterministicModelDisagreementOnHighImpact: boolean;
  unhashableOrUnauditable: boolean;
}

const DETERMINISTIC_ROUTE_CLASSES: RouteClass[] = [
  'deterministic_only',
  'deterministic_first_a5_on_uncertain',
  'deterministic_guardrail_then_a5',
];

const LOCAL_AUTONOMY_ROUTE_CLASSES: RouteClass[] = [
  ...DETERMINISTIC_ROUTE_CLASSES,
  'a5_default_with_deterministic_validator',
  'a5_plus_frontier_shadow',
];

export function evaluateHardBlockers(input: HardBlockerInput): HardBlocker[] {
  const blockers: HardBlocker[] = [];

  if (input.deterministicUnsafeAllowCount > 0) {
    blockers.push({
      reason: 'unsafe_deterministic_allow',
      surfaceId: input.surfaceId,
      description: `Deterministic path produced ${input.deterministicUnsafeAllowCount} unsafe allow decision(s)`,
      blocksRouteClass: ['deterministic_only'],
    });
  }

  if (input.missingCriticalPolicyEvidence) {
    blockers.push({
      reason: 'missing_critical_policy_evidence',
      surfaceId: input.surfaceId,
      description: 'Critical policy evidence is missing for this surface',
      blocksRouteClass: DETERMINISTIC_ROUTE_CLASSES,
    });
  }

  if (input.missingRequiredInputEvidence) {
    blockers.push({
      reason: 'missing_required_input_evidence',
      surfaceId: input.surfaceId,
      description: 'Required input evidence fields are missing',
      blocksRouteClass: ['deterministic_only'],
    });
  }

  if (input.protectedAttributeHazard) {
    blockers.push({
      reason: 'protected_attribute_hazard',
      surfaceId: input.surfaceId,
      description: 'Surface involves protected attributes — local autonomous routes are blocked; frontier/human review is required',
      blocksRouteClass: LOCAL_AUTONOMY_ROUTE_CLASSES,
    });
  }

  if (input.proseSurface) {
    blockers.push({
      reason: 'prose_surface',
      surfaceId: input.surfaceId,
      description: 'Surface requires prose generation — deterministic-only and deterministic-first are blocked',
      blocksRouteClass: ['deterministic_only', 'deterministic_first_a5_on_uncertain'],
    });
  }

  if (input.deterministicModelDisagreementOnHighImpact) {
    blockers.push({
      reason: 'deterministic_model_disagreement_high_impact',
      surfaceId: input.surfaceId,
      description: 'Deterministic and model disagree on high-impact allow/approve/release decisions',
      blocksRouteClass: ['deterministic_only', 'deterministic_first_a5_on_uncertain'],
    });
  }

  if (input.unhashableOrUnauditable) {
    blockers.push({
      reason: 'unhashable_or_unauditable_route',
      surfaceId: input.surfaceId,
      description: 'Route cannot be hashed or audited through the evidence chain',
      blocksRouteClass: DETERMINISTIC_ROUTE_CLASSES,
    });
  }

  return blockers;
}

export function isRouteBlocked(blockers: HardBlocker[], routeClass: RouteClass): boolean {
  return blockers.some(b => b.blocksRouteClass.includes(routeClass));
}
