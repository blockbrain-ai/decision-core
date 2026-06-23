import { createLogger } from '../../utils/logger.js';
import { EnterpriseRouteConfigLoader } from '../config/config-loader.js';
import { getExtractor } from '../extractors/extractor-registry.js';
import type { RuntimeSurfaceRoute } from '../types/runtime-config.js';
import type { DeterministicDecisionCandidate } from '../types/deterministic-candidate.js';
import type { RouteClass } from '../types/route-class.js';

const logger = createLogger('runtime-route-resolver');

export interface RouteResolution {
  surfaceId: string;
  routeClass: RouteClass;
  surfaceRoute: RuntimeSurfaceRoute;
  candidate: DeterministicDecisionCandidate | null;
  skipModelCall: boolean;
  reason: string;
}

const DETERMINISTIC_SKIP_ROUTE_CLASSES: Set<RouteClass> = new Set([
  'deterministic_only',
  'deterministic_first_a5_on_uncertain',
]);

const SAFE_BLOCK_ROUTE_CLASSES: Set<RouteClass> = new Set([
  'not_ready_data_or_policy_gap',
  'frontier_or_human_required',
]);

export class RuntimeRouteResolver {
  private readonly configLoader: EnterpriseRouteConfigLoader;

  constructor(configLoader?: EnterpriseRouteConfigLoader) {
    this.configLoader = configLoader ?? new EnterpriseRouteConfigLoader();
  }

  loadConfigFromJson(configJson: string): void {
    this.configLoader.loadFromJson(configJson);
    logger.info({ surfaceCount: this.configLoader.getConfig()?.surfaces.length }, 'Enterprise route config loaded');
  }

  isLoaded(): boolean {
    return this.configLoader.isLoaded();
  }

  resolve(
    surfaceId: string,
    payload: Record<string, unknown>,
    context: { tenantId: string; correlationId: string },
  ): RouteResolution | null {
    const surfaceRoute = this.configLoader.resolveSurfaceRoute(surfaceId);
    if (!surfaceRoute) {
      return null;
    }

    if (SAFE_BLOCK_ROUTE_CLASSES.has(surfaceRoute.routeClass)) {
      return {
        surfaceId,
        routeClass: surfaceRoute.routeClass,
        surfaceRoute,
        candidate: {
          surfaceId,
          routeClass: surfaceRoute.routeClass,
          decision: null,
          confidence: 0,
          confidenceTier: 'no_decision' as const,
          ruleSetId: 'safe_block',
          ruleSetVersion: '1.0.0',
          ruleSetHash: 'safe_block',
          rulesFired: [],
          missingEvidence: [],
          usedInputFields: [],
          ignoredUntrustedFields: [],
          rationale: `Surface ${surfaceId} is classified as ${surfaceRoute.routeClass}`,
          safeToExecuteWithoutModel: false,
        },
        skipModelCall: true,
        reason: `route class ${surfaceRoute.routeClass} requires safe-block — no model call permitted`,
      };
    }

    if (!DETERMINISTIC_SKIP_ROUTE_CLASSES.has(surfaceRoute.routeClass)) {
      return {
        surfaceId,
        routeClass: surfaceRoute.routeClass,
        surfaceRoute,
        candidate: null,
        skipModelCall: false,
        reason: `route class ${surfaceRoute.routeClass} requires model evaluation`,
      };
    }

    const extractor = getExtractor(surfaceId);
    if (!extractor) {
      logger.warn({ surfaceId, routeClass: surfaceRoute.routeClass }, 'No deterministic extractor for surface with deterministic route class');
      return {
        surfaceId,
        routeClass: surfaceRoute.routeClass,
        surfaceRoute,
        candidate: null,
        skipModelCall: false,
        reason: 'no deterministic extractor registered for this surface',
      };
    }

    let candidate: DeterministicDecisionCandidate;
    try {
      candidate = extractor.extract(payload, {
        tenantId: context.tenantId,
        correlationId: context.correlationId,
        surfaceId,
        ruleSetVersion: '1.0.0',
        untrustedPayloadKeys: [],
      });
    } catch (err) {
      logger.error({ err, surfaceId }, 'Deterministic extractor threw');
      return {
        surfaceId,
        routeClass: surfaceRoute.routeClass,
        surfaceRoute,
        candidate: null,
        skipModelCall: false,
        reason: `deterministic extractor failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const meetsThreshold = candidate.confidence >= surfaceRoute.confidenceThreshold;
    const isSafe = candidate.safeToExecuteWithoutModel;
    const hasDecision = candidate.decision !== null;
    const skipModelCall = meetsThreshold && isSafe && hasDecision;

    if (surfaceRoute.routeClass === 'deterministic_only' && !skipModelCall) {
      return {
        surfaceId,
        routeClass: surfaceRoute.routeClass,
        surfaceRoute,
        candidate,
        skipModelCall: false,
        reason: `deterministic_only surface failed confidence/safety check (confidence=${candidate.confidence}, threshold=${surfaceRoute.confidenceThreshold}, safe=${isSafe}); falling back to ${surfaceRoute.fallbackPattern}`,
      };
    }

    return {
      surfaceId,
      routeClass: surfaceRoute.routeClass,
      surfaceRoute,
      candidate,
      skipModelCall,
      reason: skipModelCall
        ? `deterministic resolution: confidence=${candidate.confidence}, decision=${candidate.decision}`
        : `below threshold (confidence=${candidate.confidence}, threshold=${surfaceRoute.confidenceThreshold}); falling through to model`,
    };
  }
}
