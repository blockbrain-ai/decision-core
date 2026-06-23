/**
 * A5 Hybrid Pattern
 *
 * Combines deterministic validation with model-based evaluation.
 * Sequential escalation: primary → challenger(s) → judge.
 *
 * Flow:
 * 1. Primary model evaluates
 * 2. If primary confidence is below threshold, up to 2 challengers evaluate
 * 3. If challengers also fail threshold, a judge makes the final call
 * 4. Deterministic validation always runs on the output
 */

import type { ModelGatewayAdapter } from '../../adapters/model-gateway.js';
import { createLogger } from '../../utils/logger.js';
import type { PatternContext, PatternResult, SurfaceBinding } from '../trust.contracts.js';

const logger = createLogger('a5-hybrid-pattern');

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const MAX_CHALLENGERS = 2;

export async function executeA5Hybrid(
  binding: SurfaceBinding,
  context: PatternContext,
  gateway: ModelGatewayAdapter,
): Promise<PatternResult> {
  const primaryRole = binding.roles['primary'];
  const challengerRole = binding.roles['challenger'];
  const judgeRole = binding.roles['judge'];

  if (!primaryRole) {
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'a5_hybrid',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'safe_block',
      reason: 'missing_primary_role_configuration',
    };
  }

  const confidenceThreshold = binding.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  let totalLatency = 0;

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
    totalLatency += primaryResponse.latency;
  } catch (error) {
    logger.error({ surfaceId: binding.surfaceId, error }, 'A5 primary evaluation failed');
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'a5_hybrid',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'failed',
      reason: 'primary_evaluation_failed',
    };
  }

  // If primary meets threshold, we're done
  if (primaryResponse.confidence >= confidenceThreshold) {
    return {
      output: primaryResponse.text,
      modelUsed: primaryResponse.model,
      confidence: primaryResponse.confidence,
      latency: totalLatency,
      patternUsed: 'a5_hybrid',
      verificationStatus: 'verified',
      finalDecisionSource: 'primary',
      autonomyStatus: 'verified_autonomous',
      reason: null,
    };
  }

  // Phase 2: Challengers
  if (challengerRole) {
    for (let i = 0; i < MAX_CHALLENGERS; i++) {
      try {
        const challengerPrompt = `Challenge and re-evaluate the following decision for surface "${context.surfaceId}":\n\nOriginal prompt: ${context.prompt}\n\nPrimary decision (confidence ${primaryResponse.confidence.toFixed(2)}): ${primaryResponse.text}\n\nProvide your independent assessment.`;

        const challengerResponse = await gateway.evaluate(challengerPrompt, {
          model: challengerRole.modelPolicy,
          maxTokens: challengerRole.maxTokens,
          temperature: challengerRole.temperature,
          systemPrompt: challengerRole.systemPrompt,
          context: context.metadata,
        });
        totalLatency += challengerResponse.latency;

        if (challengerResponse.confidence >= confidenceThreshold) {
          return {
            output: challengerResponse.text,
            modelUsed: challengerResponse.model,
            confidence: challengerResponse.confidence,
            latency: totalLatency,
            patternUsed: 'a5_hybrid',
            verificationStatus: 'verified',
            finalDecisionSource: 'reviewer',
            autonomyStatus: 'verified_autonomous',
            reason: null,
          };
        }
      } catch (error) {
        logger.warn({ surfaceId: binding.surfaceId, challenger: i, error }, 'Challenger evaluation failed');
        // Continue to next challenger or judge
      }
    }
  }

  // Phase 3: Judge (final authority)
  if (judgeRole) {
    try {
      const judgePrompt = `As the final judge for surface "${context.surfaceId}", make a safety-focused determination:\n\nOriginal prompt: ${context.prompt}\n\nPrimary decision: ${primaryResponse.text}\n\nThe primary and challenger models did not reach sufficient confidence. Provide your final ruling.`;

      const judgeResponse = await gateway.evaluate(judgePrompt, {
        model: judgeRole.modelPolicy,
        maxTokens: judgeRole.maxTokens,
        temperature: judgeRole.temperature,
        systemPrompt: judgeRole.systemPrompt,
        context: context.metadata,
      });
      totalLatency += judgeResponse.latency;

      return {
        output: judgeResponse.text,
        modelUsed: judgeResponse.model,
        confidence: judgeResponse.confidence,
        latency: totalLatency,
        patternUsed: 'a5_hybrid',
        verificationStatus: judgeResponse.confidence >= confidenceThreshold ? 'verified' : 'review_required',
        finalDecisionSource: 'tribunal_arbiter',
        autonomyStatus: judgeResponse.confidence >= confidenceThreshold ? 'verified_autonomous' : 'safe_block',
        reason: judgeResponse.confidence >= confidenceThreshold ? null : 'judge_confidence_below_threshold',
      };
    } catch (error) {
      logger.error({ surfaceId: binding.surfaceId, error }, 'Judge evaluation failed');
    }
  }

  // All phases exhausted — return primary with safe_block
  return {
    output: primaryResponse.text,
    modelUsed: primaryResponse.model,
    confidence: primaryResponse.confidence,
    latency: totalLatency,
    patternUsed: 'a5_hybrid',
    verificationStatus: 'review_required',
    finalDecisionSource: 'primary',
    autonomyStatus: 'safe_block',
    reason: 'all_evaluation_phases_below_threshold',
  };
}
