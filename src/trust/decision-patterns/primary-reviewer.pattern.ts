/**
 * Primary-Reviewer Pattern
 *
 * Two-phase pattern: primary model generates a decision, then a
 * reviewer model verifies it. If the reviewer fails, the result
 * is flagged as review_required but the primary output is still returned.
 */

import type { ModelGatewayAdapter } from '../../adapters/model-gateway.js';
import { createLogger } from '../../utils/logger.js';
import type { PatternContext, PatternResult, SurfaceBinding } from '../trust.contracts.js';

const logger = createLogger('primary-reviewer-pattern');

export async function executePrimaryReviewer(
  binding: SurfaceBinding,
  context: PatternContext,
  gateway: ModelGatewayAdapter,
): Promise<PatternResult> {
  const primaryRole = binding.roles['primary'];
  const reviewerRole = binding.roles['reviewer'];

  if (!primaryRole) {
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'primary_reviewer',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'safe_block',
      reason: 'missing_primary_role_configuration',
    };
  }

  if (!reviewerRole) {
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'primary_reviewer',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'safe_block',
      reason: 'missing_reviewer_role_configuration',
    };
  }

  // Phase 1: Primary evaluation
  let primaryResponse;
  try {
    primaryResponse = await gateway.evaluate(context.prompt, {
      model: primaryRole.modelPolicy,
      maxTokens: primaryRole.maxTokens,
      temperature: primaryRole.temperature,
      systemPrompt: primaryRole.systemPrompt,
      context: context.metadata,
    });
  } catch (error) {
    logger.error({ surfaceId: binding.surfaceId, error }, 'Primary evaluation failed');
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'primary_reviewer',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'failed',
      reason: 'primary_evaluation_failed',
    };
  }

  // Phase 2: Reviewer verification
  const reviewPrompt = `Review the following decision for surface "${context.surfaceId}":\n\nOriginal prompt: ${context.prompt}\n\nPrimary decision: ${primaryResponse.text}\n\nDoes this decision appear correct and safe? Respond with your assessment.`;

  let reviewerResponse;
  try {
    reviewerResponse = await gateway.evaluate(reviewPrompt, {
      model: reviewerRole.modelPolicy,
      maxTokens: reviewerRole.maxTokens,
      temperature: reviewerRole.temperature,
      systemPrompt: reviewerRole.systemPrompt,
      context: context.metadata,
    });
  } catch (error) {
    // Reviewer failed — return primary output but flag as review_required
    logger.warn({ surfaceId: binding.surfaceId, error }, 'Reviewer evaluation failed — flagging for review');
    return {
      output: primaryResponse.text,
      modelUsed: primaryResponse.model,
      confidence: primaryResponse.confidence,
      latency: primaryResponse.latency,
      patternUsed: 'primary_reviewer',
      verificationStatus: 'review_required',
      finalDecisionSource: 'primary',
      autonomyStatus: 'safe_block',
      reason: 'reviewer_evaluation_failed',
    };
  }

  // Combine confidence: use average of both
  const combinedConfidence = (primaryResponse.confidence + reviewerResponse.confidence) / 2;
  const totalLatency = primaryResponse.latency + reviewerResponse.latency;
  const meetsThreshold =
    binding.confidenceThreshold === undefined || combinedConfidence >= binding.confidenceThreshold;

  // Reviewer confidence determines verification
  const reviewerAgrees = reviewerResponse.confidence >= 0.5;

  if (reviewerAgrees && meetsThreshold) {
    return {
      output: primaryResponse.text,
      modelUsed: primaryResponse.model,
      confidence: combinedConfidence,
      latency: totalLatency,
      patternUsed: 'primary_reviewer',
      verificationStatus: 'verified',
      finalDecisionSource: 'reviewer',
      autonomyStatus: 'verified_autonomous',
      reason: null,
    };
  }

  return {
    output: primaryResponse.text,
    modelUsed: primaryResponse.model,
    confidence: combinedConfidence,
    latency: totalLatency,
    patternUsed: 'primary_reviewer',
    verificationStatus: 'review_required',
    finalDecisionSource: 'primary',
    autonomyStatus: 'safe_block',
    reason: reviewerAgrees ? 'confidence_below_threshold' : 'reviewer_disagreed',
  };
}
