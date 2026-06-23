// Types
export { RouteClassEnum, ROUTE_CLASS_PRIORITY } from './types/route-class.js';
export type { RouteClass } from './types/route-class.js';

export {
  DeterministicDecisionCandidateSchema,
  ConfidenceTierEnum,
  RuleFiredSchema,
  RuleFiredResultEnum,
} from './types/deterministic-candidate.js';
export type {
  DeterministicDecisionCandidate,
  CandidateConfidenceTier,
  RuleFired,
} from './types/deterministic-candidate.js';

export {
  ComparisonResultSchema,
  SafetyDeltaSchema,
  MatchDeltaSchema,
  CostDeltaSchema,
  EvidenceDeltaSchema,
} from './types/comparison-result.js';
export type {
  ComparisonResult,
  SafetyDelta,
  MatchDelta,
  CostDelta,
  EvidenceDelta,
} from './types/comparison-result.js';

export {
  RouteScoreSchema,
  RouteScoreComponentsSchema,
  ScoringWeightsSchema,
  HardBlockerSchema,
  HardBlockerReasonEnum,
  DEFAULT_SCORING_WEIGHTS,
} from './types/route-score.js';
export type {
  RouteScore,
  RouteScoreComponents,
  ScoringWeights,
  HardBlocker,
  HardBlockerReason,
} from './types/route-score.js';

export { RuntimeRouteConfigSchema, RuntimeSurfaceRouteSchema } from './types/runtime-config.js';
export type { RuntimeRouteConfig, RuntimeSurfaceRoute } from './types/runtime-config.js';

// Extractors
export type { DeterministicExtractor, ExtractorContext } from './extractors/extractor.types.js';
export {
  registerExtractor,
  getExtractor,
  getAllExtractors,
  hasExtractor,
  getExtractorIds,
  clearExtractors,
} from './extractors/extractor-registry.js';

// Comparison
export { runComparison, runBatchComparison } from './comparison/comparison-harness.js';
export type { A5ResultRecord, FixtureRecord, ComparisonHarnessInput } from './comparison/comparison-harness.js';
export { compareSafety } from './comparison/safety-comparator.js';
export { compareMatch } from './comparison/match-comparator.js';
export { compareCost } from './comparison/cost-comparator.js';
export { compareEvidence } from './comparison/evidence-comparator.js';

// Optimizer
export { scoreRoute, classifySurfaceNotReady } from './optimizer/route-optimizer.js';
export type { RouteOptimizerInput } from './optimizer/route-optimizer.js';
export { evaluateHardBlockers, isRouteBlocked } from './optimizer/hard-blockers.js';
export type { HardBlockerInput } from './optimizer/hard-blockers.js';
export { validateWeights, getDefaultWeights } from './optimizer/scoring-weights.js';

// Config
export { exportRuntimeConfig } from './config/config-exporter.js';
export type { ConfigExporterInput } from './config/config-exporter.js';
export { validateRuntimeConfig } from './config/config-schema.js';
export { EnterpriseRouteConfigLoader } from './config/config-loader.js';

// Evidence
export {
  bridgeDeterministicToEvidence,
  buildCandidateSummary,
  mapCandidateToConfidenceTier,
} from './evidence/deterministic-evidence-bridge.js';
export type {
  DeterministicEvidenceBridgeInput,
  DeterministicCandidateSummary,
  RouteEvidenceRecord,
  ConfidenceTier,
} from './evidence/deterministic-evidence-bridge.js';

// Runtime route resolver
export { RuntimeRouteResolver } from './runtime/runtime-route-resolver.js';
export type { RouteResolution } from './runtime/runtime-route-resolver.js';
