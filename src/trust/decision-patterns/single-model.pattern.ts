/**
 * Single Model Pattern
 *
 * Simplest pattern: one LLM call via the primary role.
 * Suitable for low-risk surfaces only.
 */

import type { ModelGatewayAdapter } from '../../adapters/model-gateway.js';
import { createLogger } from '../../utils/logger.js';
import type { PatternContext, PatternResult, SurfaceBinding } from '../trust.contracts.js';

const logger = createLogger('single-model-pattern');

export async function executeSingleModel(
  binding: SurfaceBinding,
  context: PatternContext,
  gateway: ModelGatewayAdapter,
): Promise<PatternResult> {
  const primaryRole = binding.roles['primary'];
  if (!primaryRole) {
    logger.error({ surfaceId: binding.surfaceId }, 'No primary role configured');
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'single_model',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'safe_block',
      reason: 'missing_primary_role_configuration',
    };
  }

  try {
    const response = await gateway.evaluate(context.prompt, {
      model: primaryRole.modelPolicy,
      maxTokens: primaryRole.maxTokens,
      temperature: primaryRole.temperature,
      systemPrompt: primaryRole.systemPrompt,
      context: context.metadata,
    });

    const meetsThreshold =
      binding.confidenceThreshold === undefined || response.confidence >= binding.confidenceThreshold;

    return {
      output: response.text,
      modelUsed: response.model,
      confidence: response.confidence,
      latency: response.latency,
      patternUsed: 'single_model',
      verificationStatus: meetsThreshold ? 'verified' : 'review_required',
      finalDecisionSource: 'primary',
      autonomyStatus: meetsThreshold ? 'verified_autonomous' : 'safe_block',
      reason: meetsThreshold ? null : 'confidence_below_threshold',
    };
  } catch (error) {
    logger.error({ surfaceId: binding.surfaceId, error }, 'Single model evaluation failed');
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'single_model',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'failed',
      reason: 'model_evaluation_failed',
    };
  }
}
