/**
 * Tribunal Pattern
 *
 * Multi-model consensus: 2+ assessors evaluate in parallel,
 * then an arbiter synthesizes their outputs. Lazy mode skips
 * the arbiter when assessors agree at high confidence.
 */

import type { ModelGatewayAdapter } from '../../adapters/model-gateway.js';
import { createLogger } from '../../utils/logger.js';
import type { PatternContext, PatternResult, SurfaceBinding } from '../trust.contracts.js';

const logger = createLogger('tribunal-pattern');

const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

export async function executeTribunal(
  binding: SurfaceBinding,
  context: PatternContext,
  gateway: ModelGatewayAdapter,
): Promise<PatternResult> {
  const assessorRoles = Object.entries(binding.roles).filter(([key]) => key.startsWith('assessor'));
  const arbiterRole = binding.roles['arbiter'];

  if (assessorRoles.length < 2) {
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'tribunal',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'safe_block',
      reason: 'insufficient_assessor_roles',
    };
  }

  if (!arbiterRole) {
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'tribunal',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'safe_block',
      reason: 'missing_arbiter_role_configuration',
    };
  }

  // Phase 1: Assessors evaluate in parallel
  const assessorPromises = assessorRoles.map(([, role]) =>
    gateway.evaluate(context.prompt, {
      model: role.modelPolicy,
      maxTokens: role.maxTokens,
      temperature: role.temperature,
      systemPrompt: role.systemPrompt,
      context: context.metadata,
    }),
  );

  let assessorResults;
  try {
    assessorResults = await Promise.all(assessorPromises);
  } catch (error) {
    logger.error({ surfaceId: binding.surfaceId, error }, 'Assessor evaluation failed');
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'tribunal',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'failed',
      reason: 'assessor_evaluation_failed',
    };
  }

  // Check for lazy tribunal (skip arbiter on agreement)
  const arbiterOnDisagreementOnly = binding.tribunalConfig?.arbiterOnDisagreementOnly ?? false;
  const confidenceThreshold =
    binding.tribunalConfig?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  if (arbiterOnDisagreementOnly) {
    const allHighConfidence = assessorResults.every((r) => r.confidence >= confidenceThreshold);
    const allAgree = assessorResults.every((r) => r.text === assessorResults[0].text);

    if (allHighConfidence && allAgree) {
      const maxLatency = Math.max(...assessorResults.map((r) => r.latency));
      const avgConfidence =
        assessorResults.reduce((sum, r) => sum + r.confidence, 0) / assessorResults.length;

      logger.debug({ surfaceId: binding.surfaceId }, 'Lazy tribunal — assessors agree, skipping arbiter');

      return {
        output: assessorResults[0].text,
        modelUsed: assessorResults[0].model,
        confidence: avgConfidence,
        latency: maxLatency,
        patternUsed: 'tribunal',
        verificationStatus: 'verified',
        finalDecisionSource: 'tribunal_arbiter',
        autonomyStatus: 'verified_autonomous',
        reason: null,
      };
    }
  }

  // Phase 2: Arbiter synthesizes
  const assessorSummary = assessorResults
    .map((r, i) => `Assessor ${i + 1} (${r.model}): ${r.text}`)
    .join('\n\n');

  const arbiterPrompt = `You are the arbiter for surface "${context.surfaceId}". Multiple assessors have evaluated the following:\n\nOriginal prompt: ${context.prompt}\n\nAssessor outputs:\n${assessorSummary}\n\nSynthesize these assessments into a final decision.`;

  let arbiterResponse;
  try {
    arbiterResponse = await gateway.evaluate(arbiterPrompt, {
      model: arbiterRole.modelPolicy,
      maxTokens: arbiterRole.maxTokens,
      temperature: arbiterRole.temperature,
      systemPrompt: arbiterRole.systemPrompt,
      context: context.metadata,
    });
  } catch (error) {
    logger.error({ surfaceId: binding.surfaceId, error }, 'Arbiter evaluation failed');
    // Fail closed — do not fall through to allow
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'tribunal',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'failed',
      reason: 'arbiter_evaluation_failed',
    };
  }

  const maxAssessorLatency = Math.max(...assessorResults.map((r) => r.latency));
  const totalLatency = maxAssessorLatency + arbiterResponse.latency;

  return {
    output: arbiterResponse.text,
    modelUsed: arbiterResponse.model,
    confidence: arbiterResponse.confidence,
    latency: totalLatency,
    patternUsed: 'tribunal',
    verificationStatus: arbiterResponse.confidence >= confidenceThreshold ? 'verified' : 'review_required',
    finalDecisionSource: 'tribunal_arbiter',
    autonomyStatus: arbiterResponse.confidence >= confidenceThreshold ? 'verified_autonomous' : 'safe_block',
    reason: arbiterResponse.confidence >= confidenceThreshold ? null : 'arbiter_confidence_below_threshold',
  };
}
