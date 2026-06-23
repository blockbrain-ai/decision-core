/**
 * Tribunal Executor
 *
 * Orchestrates tribunal-style decisions with panel resolution.
 * Requires a ModelGatewayAdapter — fails closed if unavailable.
 */

import type { ModelGatewayAdapter } from '../../adapters/model-gateway.js';
import { createLogger } from '../../utils/logger.js';
import type { PatternContext, PatternResult, TribunalPanel } from '../trust.contracts.js';

const logger = createLogger('tribunal-executor');

export interface TribunalExecutorOptions {
  gateway: ModelGatewayAdapter;
  panel: TribunalPanel;
}

/**
 * Execute a tribunal decision with a resolved panel.
 */
export async function executeTribunalWithPanel(
  context: PatternContext,
  options: TribunalExecutorOptions,
): Promise<PatternResult> {
  const { gateway, panel } = options;

  logger.debug(
    { surfaceId: context.surfaceId, panelId: panel.panelId, assessors: panel.assessors.length },
    'Executing tribunal with panel',
  );

  // Run assessors in parallel
  const assessorPromises = panel.assessors.map((assessor) =>
    gateway.evaluate(context.prompt, {
      model: assessor.modelPolicy,
      maxTokens: assessor.maxTokens,
      temperature: assessor.temperature,
    }),
  );

  let assessorResults;
  try {
    assessorResults = await Promise.all(assessorPromises);
  } catch (error) {
    logger.error({ panelId: panel.panelId, error }, 'Tribunal assessor evaluation failed');
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'tribunal',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'failed',
      reason: 'tribunal_assessor_evaluation_failed',
    };
  }

  // Check lazy tribunal shortcut
  const confidenceThreshold = panel.confidenceThreshold ?? 0.85;
  const arbiterOnDisagreementOnly = panel.arbiterOnDisagreementOnly ?? false;

  if (arbiterOnDisagreementOnly) {
    const allHighConfidence = assessorResults.every((r) => r.confidence >= confidenceThreshold);
    const allAgree = assessorResults.every((r) => r.text === assessorResults[0].text);

    if (allHighConfidence && allAgree) {
      const maxLatency = Math.max(...assessorResults.map((r) => r.latency));
      const avgConfidence =
        assessorResults.reduce((sum, r) => sum + r.confidence, 0) / assessorResults.length;

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

  // Invoke arbiter
  const assessorSummary = assessorResults
    .map((r, i) => `Assessor ${i + 1} (${r.model}): ${r.text}`)
    .join('\n\n');

  const arbiterPrompt = `You are the arbiter for surface "${context.surfaceId}". Synthesize these assessments:\n\n${assessorSummary}\n\nProvide your final determination.`;

  let arbiterResponse;
  try {
    arbiterResponse = await gateway.evaluate(arbiterPrompt, {
      model: panel.arbiter.modelPolicy,
      maxTokens: panel.arbiter.maxTokens,
      temperature: panel.arbiter.temperature,
    });
  } catch (error) {
    logger.error({ panelId: panel.panelId, error }, 'Tribunal arbiter evaluation failed');
    return {
      output: null,
      modelUsed: null,
      confidence: null,
      latency: null,
      patternUsed: 'tribunal',
      verificationStatus: 'fallback',
      finalDecisionSource: 'fallback',
      autonomyStatus: 'failed',
      reason: 'tribunal_arbiter_evaluation_failed',
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
