import { hashCanonicalJson } from '../../utils/audit-hash.js';
import type { RouteScore } from '../types/route-score.js';
import type { RuntimeRouteConfig, RuntimeSurfaceRoute } from '../types/runtime-config.js';
import { RuntimeRouteConfigSchema } from '../types/runtime-config.js';
import { hasExtractor, getExtractor } from '../extractors/extractor-registry.js';

export interface ConfigExporterInput {
  enterpriseId: string;
  scores: RouteScore[];
  optimizerVersion: string;
}

export function exportRuntimeConfig(input: ConfigExporterInput): RuntimeRouteConfig {
  const { enterpriseId, scores, optimizerVersion } = input;

  const surfaces: RuntimeSurfaceRoute[] = scores.map(score => {
    const extractor = hasExtractor(score.surfaceId) ? getExtractor(score.surfaceId) : undefined;

    return {
      surfaceId: score.surfaceId,
      routeClass: score.recommendedRouteClass,
      deterministicExtractorId: extractor ? extractor.ruleSetId : null,
      confidenceThreshold: deriveConfidenceThreshold(score),
      fallbackPattern: deriveFallbackPattern(score),
      frontierShadow: score.recommendedRouteClass === 'a5_plus_frontier_shadow',
      humanReviewOnDisagreement: score.hardBlockerCount > 0 || score.recommendedRouteClass === 'frontier_or_human_required',
      policyEvidenceRequired: true,
      scoreSummary: {
        weightedTotal: score.weightedTotal,
        hardBlockerCount: score.hardBlockerCount,
      },
    };
  });

  const configBody = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    enterpriseId,
    configHash: '',
    optimizerVersion,
    surfaces,
  };

  configBody.configHash = hashCanonicalJson({
    version: configBody.version,
    enterpriseId: configBody.enterpriseId,
    optimizerVersion: configBody.optimizerVersion,
    surfaces: configBody.surfaces,
  });

  return RuntimeRouteConfigSchema.parse(configBody);
}

function deriveConfidenceThreshold(score: RouteScore): number {
  switch (score.recommendedRouteClass) {
    case 'deterministic_only':
      return 0.99;
    case 'deterministic_first_a5_on_uncertain':
      return 0.90;
    case 'deterministic_guardrail_then_a5':
      return 0.70;
    default:
      return 0.50;
  }
}

function deriveFallbackPattern(score: RouteScore): string {
  switch (score.recommendedRouteClass) {
    case 'deterministic_only':
      return 'safe_block';
    case 'deterministic_first_a5_on_uncertain':
    case 'deterministic_guardrail_then_a5':
      return 'a5_hybrid';
    case 'a5_default_with_deterministic_validator':
      return 'primary_reviewer';
    case 'a5_plus_frontier_shadow':
      return 'primary_reviewer';
    case 'frontier_or_human_required':
      return 'human_review';
    case 'not_ready_data_or_policy_gap':
      return 'safe_block';
  }
}
