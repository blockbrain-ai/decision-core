/**
 * Surface Binding Resolver
 *
 * Given a surface ID, resolves to the appropriate routing pattern
 * and configuration. This is the main entry point for trust-based
 * decision routing.
 */

import type { ModelGatewayAdapter } from '../adapters/model-gateway.js';
import { createLogger } from '../utils/logger.js';
import type { PatternContext, PatternResult } from './trust.contracts.js';
import { TrustPolicyLoader } from './trust-policy.js';
import { executePattern } from './decision-patterns/pattern-executor.js';

const logger = createLogger('surface-resolver');

export interface SurfaceResolverOptions {
  gateway?: ModelGatewayAdapter;
}

export class SurfaceResolver {
  constructor(private readonly policyLoader: TrustPolicyLoader) {}

  /**
   * Resolve a surface ID and execute its bound decision pattern.
   *
   * Returns a fail-closed result if:
   * - The surface has no binding configured
   * - The pattern requires a gateway but none is provided
   */
  async resolve(
    surfaceId: string,
    context: Omit<PatternContext, 'surfaceId'>,
    options: SurfaceResolverOptions = {},
  ): Promise<PatternResult> {
    const binding = this.policyLoader.getBinding(surfaceId);

    if (!binding) {
      logger.warn({ surfaceId }, 'No surface binding found — failing closed');
      return {
        output: null,
        modelUsed: null,
        confidence: null,
        latency: null,
        patternUsed: 'single_model',
        verificationStatus: 'fallback',
        finalDecisionSource: 'fallback',
        autonomyStatus: 'safe_block',
        reason: 'surface_binding_not_found',
      };
    }

    const fullContext: PatternContext = {
      surfaceId,
      ...context,
    };

    return executePattern(binding, fullContext, { gateway: options.gateway });
  }

  /**
   * Check if a surface ID has a binding configured.
   */
  hasBinding(surfaceId: string): boolean {
    return this.policyLoader.getBinding(surfaceId) !== null;
  }

  /**
   * Get the pattern type for a surface without executing.
   */
  getPatternType(surfaceId: string): string | null {
    const binding = this.policyLoader.getBinding(surfaceId);
    return binding?.pattern ?? null;
  }
}
