/**
 * Pattern Executor
 *
 * Dispatches execution to the appropriate decision pattern based on
 * the surface binding configuration. Each pattern implements a different
 * level of scrutiny for model-assisted decisions.
 */

import type { ModelGatewayAdapter } from '../../adapters/model-gateway.js';
import { createLogger } from '../../utils/logger.js';
import type { PatternContext, PatternResult, SurfaceBinding, PatternType } from '../trust.contracts.js';
import { executeSingleModel } from './single-model.pattern.js';
import { executePrimaryReviewer } from './primary-reviewer.pattern.js';
import { executeTribunal } from './tribunal.pattern.js';
import { executeA5Hybrid } from './a5-hybrid.pattern.js';

const logger = createLogger('pattern-executor');

export interface PatternExecutorOptions {
  gateway?: ModelGatewayAdapter;
}

/**
 * Execute the decision pattern specified by the surface binding.
 *
 * If a model-dependent pattern is requested but no ModelGatewayAdapter
 * is available, the executor applies fail-closed behavior per the
 * binding's fallback strategy.
 */
export async function executePattern(
  binding: SurfaceBinding,
  context: PatternContext,
  options: PatternExecutorOptions = {},
): Promise<PatternResult> {
  const { gateway } = options;

  logger.debug(
    { surfaceId: binding.surfaceId, pattern: binding.pattern, hasGateway: !!gateway },
    'Executing decision pattern',
  );

  // All patterns except certain deterministic paths require a gateway
  if (!gateway && requiresGateway(binding.pattern)) {
    return failClosed(binding, context);
  }

  switch (binding.pattern) {
    case 'single_model':
      return executeSingleModel(binding, context, gateway!);

    case 'primary_reviewer':
      return executePrimaryReviewer(binding, context, gateway!);

    case 'tribunal':
      return executeTribunal(binding, context, gateway!);

    case 'a5_hybrid':
      return executeA5Hybrid(binding, context, gateway!);

    default: {
      const _exhaustive: never = binding.pattern;
      return failClosed(binding, context);
    }
  }
}

function requiresGateway(_pattern: PatternType): boolean {
  // All 4 patterns require a model gateway
  return true;
}

/**
 * Fail-closed: return a safe-block result when the gateway is unavailable.
 * Never silently allows — always returns deny with an explicit reason.
 */
function failClosed(binding: SurfaceBinding, _context: PatternContext): PatternResult {
  logger.warn(
    { surfaceId: binding.surfaceId, pattern: binding.pattern },
    'Model gateway unavailable — failing closed',
  );

  return {
    output: null,
    modelUsed: null,
    confidence: null,
    latency: null,
    patternUsed: binding.pattern,
    verificationStatus: 'fallback',
    finalDecisionSource: 'fallback',
    autonomyStatus: 'safe_block',
    reason: 'model_gateway_unavailable',
  };
}
